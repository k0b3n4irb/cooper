// Pure metasprite + animation-clip C emitters — no `vscode` import, Node-testable.
//
// The OpenSNES library (sprite.h, opensnes#97) delegates the metasprite `tile`
// computation to the editor: `tile` is an 8x8 OAM **character-name** offset for
// the sheet as it sits in VRAM, NOT a block index. gfx4snes `-T` currently
// emits block indices and renders wrong for 16/32px blocks (opensnes#100), so
// Cooper computes names from the sheet geometry itself.
//
// The char-name uses the SAME grounded truth as Add Sprite → sheets
// (`sheetFrameTile`): gfx4snes packs cells **row-major into 16-tile-wide VRAM
// bands** (`-o 16`). The cell at grid (col,row) is row-major index
// `row*(sheetWidthPx/cellPx) + col`. (Before D-071 this used
// `col*cellNames + row*(sheetWidthPx/8)*cellNames`, which is only correct when
// the sheet is 128px wide — i.e. one sheet-row == one band. Fixed to the band
// formula, verified against real gfx4snes output.)

import { sheetFrameTile } from './spriteScaffold';

export const OBJ_FLIPX = 0x40;
export const OBJ_FLIPY = 0x80;
export const objPal = (pal: number): number => (pal & 0x07) << 1;
export const objPrio = (prio: number): number => (prio & 0x03) << 4;

export interface MetaItem { dx: number; dy: number; tile: number; attr: number; }
export interface CellRef { col: number; row: number; flipX?: boolean; flipY?: boolean; }

/** 8x8 OAM character-name of a `cellPx`-square cell at grid (col,row), for a
 *  sheet `sheetWidthPx` wide as gfx4snes (`-o 16`) lays it in VRAM. */
export function charName(col: number, row: number, cellPx: number, sheetWidthPx: number): number {
    const cols = Math.floor(sheetWidthPx / cellPx);   // cells per sheet-row
    return sheetFrameTile(row * cols + col, cellPx);   // row-major index → band-packed tile
}

export interface GridMetaOpts {
    sheetWidthPx: number;
    cellPx: number;      // OBJ sub-sprite size (8/16/32/64)
    startCol: number;    // top-left source cell of the metasprite, in cell units
    startRow: number;
    cols: number;        // metasprite width in cells
    rows: number;        // metasprite height in cells
    pal?: number;
    prio?: number;
}

/**
 * A rectangular metasprite: `cols×rows` sub-sprites laid contiguously, each
 * pointing at the matching source cell (startCol+i, startRow+j) and screen-
 * offset by (i*cellPx, j*cellPx) from the origin. Tiles are correct char-names.
 */
export function gridMetasprite(o: GridMetaOpts): MetaItem[] {
    const attr = objPal(o.pal ?? 0) | objPrio(o.prio ?? 0);
    const items: MetaItem[] = [];
    for (let j = 0; j < o.rows; j++) {
        for (let i = 0; i < o.cols; i++) {
            items.push({
                dx: i * o.cellPx,
                dy: j * o.cellPx,
                tile: charName(o.startCol + i, o.startRow + j, o.cellPx, o.sheetWidthPx),
                attr,
            });
        }
    }
    return items;
}

const attrExpr = (attr: number): string => {
    const parts: string[] = [];
    if (attr & OBJ_FLIPX) {
        parts.push('OBJ_FLIPX');
    }
    if (attr & OBJ_FLIPY) {
        parts.push('OBJ_FLIPY');
    }
    const pal = (attr >> 1) & 0x07;
    if (pal) {
        parts.push(`OBJ_PAL(${pal})`);
    }
    const prio = (attr >> 4) & 0x03;
    parts.push(`OBJ_PRIO(${prio})`);
    return parts.join(' | ') || '0';
};

/** Emit a `const MetaspriteItem <name>[]` table terminated by METASPR_TERM. */
export function emitMetasprite(name: string, items: MetaItem[]): string {
    const rows = items.map((it) => `    METASPR_ITEM(${it.dx}, ${it.dy}, ${it.tile}, ${attrExpr(it.attr)}),`);
    return `static const MetaspriteItem ${name}[] = {\n${rows.join('\n')}\n    METASPR_TERM\n};\n`;
}

export interface AnimClipOpts {
    /** frame values animTick() returns (e.g. OAM tiles or metasprite indices). */
    frames: number[];
    mode?: 'ANIM_LOOP' | 'ANIM_ONCE';
    speed?: number;          // ticks per frame (uniform)
    durations?: number[];    // per-frame ticks; overrides speed when present
}

/** Emit an anim.h clip: DECLARE_ANIM_CLIP for uniform speed, else the raw form. */
export function emitAnimClip(name: string, o: AnimClipOpts): string {
    const mode = o.mode ?? 'ANIM_LOOP';
    if (o.durations && o.durations.length) {
        if (o.durations.length !== o.frames.length) {
            throw new Error('durations length must match frames length');
        }
        return `static const u16 ${name}_frames[] = { ${o.frames.join(', ')} };\n`
            + `static const u8 ${name}_durations[] = { ${o.durations.join(', ')} };\n`
            + `static const AnimClip ${name} = { ${name}_frames, ${name}_durations, ${o.frames.length}, 0, ${mode}, 0 };\n`;
    }
    return `DECLARE_ANIM_CLIP(${name}, ${mode}, ${o.speed ?? 1}, ${o.frames.join(', ')});\n`;
}
