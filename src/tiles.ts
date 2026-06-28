// Pure SNES tile (CHR) decode + a minimal PNG encoder — no `vscode` import, so
// it's Node-testable. The VRAM tile viewer reads `peek_vram` bytes, decodes
// planar 8×8 tiles, colours them with a CGRAM sub-palette, and renders a PNG.
//
// SNES planar format: N bitplanes for Nbpp. Planes are stored in pairs of
// 16-byte blocks (rows interleaved): plane k of row r is at
//   base + floor(k/2)*16 + r*2 + (k&1).
// Pixel index = sum over planes of bit<<plane. Grounded: peek_vram tile 1 of
// aim_target = a font glyph (column-3/4 bits set).

import * as zlib from 'zlib';
import { Rgb } from './ppu';

/** Bytes per 8×8 tile for a given bit depth. */
export const bytesPerTile = (bpp: number): number => bpp * 8;

/** Decode one 8×8 tile at byte `base` to 64 palette indices (0..2^bpp-1). */
export function decodeTile(bytes: number[], base: number, bpp: number): number[] {
    const px = new Array(64).fill(0);
    for (let r = 0; r < 8; r++) {
        for (let pl = 0; pl < bpp; pl++) {
            const b = bytes[base + (pl >> 1) * 16 + r * 2 + (pl & 1)] ?? 0;
            if (!b) {
                continue;
            }
            for (let c = 0; c < 8; c++) {
                if (b & (0x80 >> c)) {
                    px[r * 8 + c] |= (1 << pl);
                }
            }
        }
    }
    return px;
}

/** Decode `count` consecutive tiles. */
export function decodeTileSheet(bytes: number[], bpp: number, count: number): number[][] {
    const bpt = bytesPerTile(bpp);
    const tiles: number[][] = [];
    for (let t = 0; t < count; t++) {
        tiles.push(decodeTile(bytes, t * bpt, bpp));
    }
    return tiles;
}

export interface Rgba { width: number; height: number; data: Uint8Array; }

/** Lay tiles into an RGBA bitmap grid, coloured by `palette` (length ≥ 2^bpp). */
export function tilesToRgba(tiles: number[][], palette: Rgb[], tilesPerRow: number): Rgba {
    const rows = Math.max(1, Math.ceil(tiles.length / tilesPerRow));
    const width = tilesPerRow * 8;
    const height = rows * 8;
    const data = new Uint8Array(width * height * 4);
    tiles.forEach((tile, ti) => {
        const tx = (ti % tilesPerRow) * 8;
        const ty = Math.floor(ti / tilesPerRow) * 8;
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const col = palette[tile[r * 8 + c]] ?? { r: 0, g: 0, b: 0 };
                const o = ((ty + r) * width + (tx + c)) * 4;
                data[o] = col.r; data[o + 1] = col.g; data[o + 2] = col.b; data[o + 3] = 255;
            }
        }
    });
    return { width, height, data };
}

// --- minimal PNG encoder (RGBA / colour type 6), zlib for IDAT ---

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

function crc32(buf: Buffer): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) {
        c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

/** Encode an RGBA bitmap as a PNG (no filtering; zlib-deflated IDAT). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // colour type RGBA
    // rest (compression/filter/interlace) = 0
    const stride = width * 4;
    const raw = Buffer.alloc(height * (1 + stride));
    for (let y = 0; y < height; y++) {
        raw[y * (1 + stride)] = 0; // filter: none
        Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (1 + stride) + 1);
    }
    const idat = zlib.deflateSync(raw);
    return Buffer.concat([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', Buffer.alloc(0))]);
}

/** Render a VRAM tile sheet as a webview `<img>` (PNG data URI, pixelated,
 *  upscaled to `displayWidth` px). */
export function renderVramHtml(pngBase64: string, cspSource: string, info: string, displayWidth = 512): string {
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 8px; }
  h3 { margin: 0 0 8px; font-size: 13px; }
  img { image-rendering: pixelated; border: 1px solid #8884; }
</style></head><body>
<h3>VRAM tiles — ${info}</h3>
<img src="data:image/png;base64,${pngBase64}" width="${displayWidth}">
</body></html>`;
}
