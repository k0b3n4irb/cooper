// Pure SNES tilemap assembly for the read-only tilemap viewer — no `vscode`
// import. Reads a gfx4snes `.map` (16-bit entries) and paints it into an RGBA
// image using the tileset (`.pic`) + palette (`.pal`), applying the real SNES
// per-cell attributes (sub-palette + H/V flip) — which Tiled does not show
// hardware-faithfully. Grounded in the SDK (gfx4snes/common.h, tmx2snes.c):
// entry = `vhopppcc cccccccc` → tile 0-1023 (bits 0-9), palette (10-12),
// priority (13), H-flip (14), V-flip (15).

import { Rgb } from './pngPalette';
import { Rgba } from './tiles';

export interface TileEntry {
    tile: number;
    pal: number;
    prio: number;
    hflip: number;
    vflip: number;
}

/** Parse a `.map` blob (little-endian 16-bit entries) into per-cell attributes. */
export function parseTilemapEntries(bytes: ArrayLike<number>): TileEntry[] {
    const out: TileEntry[] = [];
    for (let i = 0; i + 1 < bytes.length; i += 2) {
        const e = (bytes[i] | (bytes[i + 1] << 8)) & 0xFFFF;
        out.push({
            tile: e & 0x03FF,
            pal: (e >> 10) & 7,
            prio: (e >> 13) & 1,
            hflip: (e >> 14) & 1,
            vflip: (e >> 15) & 1,
        });
    }
    return out;
}

/**
 * Assemble the map into an RGBA image: `tiles` are the decoded 8×8 index arrays
 * (from `decodeTileSheet`), `palette` the full CGRAM as RGB (sub-palette n =
 * entries n*16..n*16+15 for 4bpp), `width` the map width in tiles. Index 0 is
 * transparent. Flips are applied per cell.
 */
export function assembleTilemapRgba(entries: TileEntry[], tiles: number[][], palette: Rgb[], width: number): Rgba {
    const height = Math.max(1, Math.ceil(entries.length / width));
    const W = width * 8, H = height * 8;
    const data = new Uint8Array(W * H * 4);
    for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        const tile = tiles[e.tile] ?? tiles[0] ?? [];
        const cx = (i % width) * 8, cy = Math.floor(i / width) * 8;
        for (let ty = 0; ty < 8; ty++) {
            for (let tx = 0; tx < 8; tx++) {
                const sx = e.hflip ? 7 - tx : tx;
                const sy = e.vflip ? 7 - ty : ty;
                const idx = tile[sy * 8 + sx] ?? 0;
                const o = ((cy + ty) * W + (cx + tx)) * 4;
                if (idx === 0) {
                    data[o + 3] = 0; // transparent
                    continue;
                }
                const c = palette[e.pal * 16 + idx] ?? { r: 0, g: 0, b: 0 };
                data[o] = c.r; data[o + 1] = c.g; data[o + 2] = c.b; data[o + 3] = 255;
            }
        }
    }
    return { width: W, height: H, data };
}
