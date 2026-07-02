// Pure PNG-palette surgery for the SNES palette editor — no `vscode` import, so
// it's Node-testable. The authored source is the **indexed PNG** that `gfx4snes`
// consumes (`gfx4snes … -i asset.png` → `.pal`/`.pic`); we edit that PNG's PLTE
// and let the build regenerate the binaries (Cooper's "edit source" rule).
//
// SNES colour truth (grounded in OpenSNES `lib/include/snes/video.h:83`):
// CGRAM is 15-bit BGR555 — `RGB(r,g,b) = (b<<10)|(g<<5)|r`, each channel 0..31.
// gfx4snes converts the PNG's 8-bit RGB palette with `>>3`, so we display/edit in
// that exact 5-bit space and expand back with `(v<<3)|(v>>2)` (round-trips `>>3`).

export interface Rgb { r: number; g: number; b: number; }

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

// --- CRC32 (PNG chunk checksum) -----------------------------------------------
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(bytes: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

// --- BGR555 ↔ RGB8 (the gfx4snes-compatible convention) -----------------------

/** 8-bit RGB → 15-bit BGR555, exactly as gfx4snes does (`>>3` per channel). */
export function rgb8ToBgr555(c: Rgb): number {
    return (((c.b >> 3) & 31) << 10) | (((c.g >> 3) & 31) << 5) | ((c.r >> 3) & 31);
}

/** 15-bit BGR555 → 8-bit RGB, expanding 5→8 with `(v<<3)|(v>>2)` so a later
 *  `>>3` recovers the original 5-bit value (lossless round-trip). */
export function bgr555ToRgb8(v: number): Rgb {
    const e = (x: number) => ((x << 3) | (x >> 2)) & 0xFF;
    return { r: e(v & 31), g: e((v >> 5) & 31), b: e((v >> 10) & 31) };
}

/** Snap an arbitrary 8-bit RGB to the nearest representable SNES colour. */
export function snapToBgr555(c: Rgb): Rgb {
    return bgr555ToRgb8(rgb8ToBgr555(c));
}

// --- PNG chunk walk -----------------------------------------------------------

interface Chunk { type: string; start: number; dataStart: number; length: number; }

function walk(buf: Buffer): Chunk[] {
    for (let i = 0; i < SIG.length; i++) {
        if (buf[i] !== SIG[i]) {
            throw new Error('not a PNG file');
        }
    }
    const chunks: Chunk[] = [];
    let p = 8;
    while (p + 8 <= buf.length) {
        const length = buf.readUInt32BE(p);
        const type = buf.toString('ascii', p + 4, p + 8);
        chunks.push({ type, start: p, dataStart: p + 8, length });
        p += 12 + length; // len(4)+type(4)+data(length)+crc(4)
        if (type === 'IEND') {
            break;
        }
    }
    return chunks;
}

export interface IndexedPng {
    width: number;
    height: number;
    bitDepth: number;
    /** PNG colour type; 3 = indexed (has a PLTE). */
    colorType: number;
    /** The PLTE entries as 8-bit RGB. */
    palette: Rgb[];
}

/** Parse an indexed PNG's header + palette. Throws if it isn't indexed (no PLTE). */
export function readIndexedPng(buf: Buffer): IndexedPng {
    const chunks = walk(buf);
    const ihdr = chunks.find((c) => c.type === 'IHDR');
    const plte = chunks.find((c) => c.type === 'PLTE');
    if (!ihdr) {
        throw new Error('PNG has no IHDR');
    }
    const colorType = buf[ihdr.dataStart + 9];
    if (!plte) {
        throw new Error('PNG is not indexed (no PLTE) — the palette editor needs a 256-colour indexed PNG');
    }
    const palette: Rgb[] = [];
    for (let i = 0; i + 2 < plte.length; i += 3) {
        palette.push({ r: buf[plte.dataStart + i], g: buf[plte.dataStart + i + 1], b: buf[plte.dataStart + i + 2] });
    }
    return {
        width: buf.readUInt32BE(ihdr.dataStart),
        height: buf.readUInt32BE(ihdr.dataStart + 4),
        bitDepth: buf[ihdr.dataStart + 8],
        colorType,
        palette,
    };
}

/**
 * Return a new PNG buffer with the PLTE replaced by `palette` (same entry count),
 * every other chunk (IHDR, IDAT pixels, tRNS…) untouched. The CRC is recomputed.
 */
export function writePalette(buf: Buffer, palette: Rgb[]): Buffer {
    const chunks = walk(buf);
    const plte = chunks.find((c) => c.type === 'PLTE');
    if (!plte) {
        throw new Error('PNG is not indexed (no PLTE)');
    }
    const entries = plte.length / 3;
    const data = Buffer.alloc(plte.length);
    for (let i = 0; i < entries; i++) {
        const c = palette[i] ?? { r: 0, g: 0, b: 0 };
        data[i * 3] = c.r & 0xFF;
        data[i * 3 + 1] = c.g & 0xFF;
        data[i * 3 + 2] = c.b & 0xFF;
    }
    // The chunk is length(4)+type(4)+data+crc(4). Overwrite data + crc in place.
    const out = Buffer.from(buf);
    data.copy(out, plte.dataStart);
    const crcInput = out.subarray(plte.start + 4, plte.dataStart + plte.length); // type + data
    out.writeUInt32BE(crc32(crcInput), plte.dataStart + plte.length);
    return out;
}
