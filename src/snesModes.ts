// The SNES graphics constraint model — no `vscode` import, Node-testable.
//
// This is the spine of Cooper's mode-driven asset editors: the hardware rules
// (BG modes → layer count + colour depth; OBSEL → sprite sizes; CGRAM layout;
// VRAM budget) encoded as DATA, so every editor derives what's legal from the
// project's chosen mode and makes impossible states unrepresentable.
//
// Grounded in the OpenSNES headers (the source of truth), cross-checked in the
// tests against their #defines:
//   video.h      BG_MODE0..7 (layer count + depth per mode)
//   background.h BG_4COLORS=4 / BG_16COLORS=16 / BG_256COLORS=256
//   sprite.h     OBJ_SIZE8_L16..OBJ_SIZE32_L64 (6 pairs); OBJ_CGRAM_BASE=128;
//                OBJ_CGRAM_PAL(n)=128+n*16; MAX_SPRITES=128

export type Bpp = 2 | 4 | 8;
export type BgNum = 1 | 2 | 3 | 4;

/** Colours in a sub-palette for a given bit depth (color 0 = transparent). */
export function bppColors(bpp: Bpp): number {
    return 1 << bpp; // 2→4, 4→16, 8→256
}

export interface BgLayer {
    bg: BgNum;
    bpp: Bpp;
    colors: number; // = bppColors(bpp)
}

export interface BgMode {
    mode: number; // 0..7
    layers: BgLayer[]; // active BG layers with their depth
    offsetPerTile: boolean;
    hiRes: boolean; // 512-px-wide modes (5, 6)
    rotation: boolean; // mode 7 affine
    /** One-line didactic summary for the mode picker. */
    description: string;
}

const layer = (bg: BgNum, bpp: Bpp): BgLayer => ({ bg, bpp, colors: bppColors(bpp) });

/** The eight BG modes, indexed by mode number (grounded in video.h). */
export const BG_MODES: readonly BgMode[] = [
    { mode: 0, layers: [layer(1, 2), layer(2, 2), layer(3, 2), layer(4, 2)], offsetPerTile: false, hiRes: false, rotation: false,
        description: 'Four background layers, 4 colours each — great for text, HUDs and simple tile art.' },
    { mode: 1, layers: [layer(1, 4), layer(2, 4), layer(3, 2)], offsetPerTile: false, hiRes: false, rotation: false,
        description: 'The workhorse: two rich 16-colour layers plus a 4-colour layer (often the HUD/text).' },
    { mode: 2, layers: [layer(1, 4), layer(2, 4)], offsetPerTile: true, hiRes: false, rotation: false,
        description: 'Two 16-colour layers with per-column offset (parallax) — no third layer.' },
    { mode: 3, layers: [layer(1, 8), layer(2, 4)], offsetPerTile: false, hiRes: false, rotation: false,
        description: 'One 256-colour layer plus a 16-colour layer — for detailed backdrops.' },
    { mode: 4, layers: [layer(1, 8), layer(2, 2)], offsetPerTile: true, hiRes: false, rotation: false,
        description: 'A 256-colour layer + a 4-colour layer, with per-column offset.' },
    { mode: 5, layers: [layer(1, 4), layer(2, 2)], offsetPerTile: false, hiRes: true, rotation: false,
        description: 'Hi-res 512-wide: a 16-colour and a 4-colour layer (interlace/menus).' },
    { mode: 6, layers: [layer(1, 4)], offsetPerTile: true, hiRes: true, rotation: false,
        description: 'Hi-res 512-wide, one 16-colour layer with per-column offset.' },
    { mode: 7, layers: [layer(1, 8)], offsetPerTile: false, hiRes: false, rotation: true,
        description: 'One 256-colour layer that rotates and scales (Mode 7) — maps, racers, effects.' },
];

/** The BG mode record, or throws for an out-of-range mode. */
export function bgMode(mode: number): BgMode {
    const m = BG_MODES[mode];
    if (!m) {
        throw new Error(`invalid BG mode ${mode} (0..7)`);
    }
    return m;
}

// --- Sprites (OBSEL) — independent of the BG mode (sprite.h) -----------------

export interface ObjSizePair {
    id: number; // OBJ_SIZE* value 0..5
    small: number; // px
    large: number; // px
    name: string; // e.g. "16/32"
}

/** The six OBSEL size pairs; a sprite is small or large within its pair. */
export const OBJ_SIZE_PAIRS: readonly ObjSizePair[] = [
    { id: 0, small: 8, large: 16, name: '8/16' },
    { id: 1, small: 8, large: 32, name: '8/32' },
    { id: 2, small: 8, large: 64, name: '8/64' },
    { id: 3, small: 16, large: 32, name: '16/32' },
    { id: 4, small: 16, large: 64, name: '16/64' },
    { id: 5, small: 32, large: 64, name: '32/64' },
];

export function objSizePair(id: number): ObjSizePair {
    const p = OBJ_SIZE_PAIRS[id];
    if (!p) {
        throw new Error(`invalid OBJ size id ${id} (0..5)`);
    }
    return p;
}

/** Sprites are always 4bpp / 16 colours, 8 palettes, 128 max. */
export const SPRITE_BPP: Bpp = 4;
export const SPRITE_PALETTES = 8;
export const MAX_SPRITES = 128;

// --- CGRAM / palette layout (sprite.h + hardware) ---------------------------

export const CGRAM_SIZE = 256;
export const OBJ_CGRAM_BASE = 128; // sprites use colours 128..255

/** First CGRAM index of sprite palette `n` (0..7): 128 + n*16. */
export function objPaletteBase(n: number): number {
    return OBJ_CGRAM_BASE + n * 16;
}

/**
 * How the BG colour region (indices 0..127, or the full 256 for an 8bpp layer)
 * splits into sub-palettes for a layer of the given depth. Color 0 of each is
 * transparent.
 */
export function bgPaletteLayout(bpp: Bpp): { subPaletteSize: number; subPaletteCount: number } {
    const subPaletteSize = bppColors(bpp);
    // An 8bpp layer addresses all 256 CGRAM colours (one big palette); 2/4bpp
    // layers live in the 128-colour BG region.
    const region = bpp === 8 ? CGRAM_SIZE : OBJ_CGRAM_BASE;
    return { subPaletteSize, subPaletteCount: Math.max(1, Math.floor(region / subPaletteSize)) };
}

// --- VRAM / tile budget -----------------------------------------------------

export const VRAM_BYTES = 0x10000; // 64 KB

/** Bytes for one 8x8 tile at a given depth (2bpp=16, 4bpp=32, 8bpp=64). */
export function bytesPerTile(bpp: Bpp): number {
    return bpp * 8;
}

/** Max distinct 8x8 tiles that fit in VRAM at a depth (ignoring maps/OAM). */
export function maxTiles(bpp: Bpp): number {
    return Math.floor(VRAM_BYTES / bytesPerTile(bpp));
}

// --- The project's chosen configuration + validation ------------------------

export interface GraphicsConfig {
    mode: number; // BG mode 0..7
    objSize: number; // OBJ_SIZE* id 0..5
}

export const DEFAULT_GRAPHICS: GraphicsConfig = { mode: 1, objSize: 0 };

/** Colour depth of a given BG in a mode, or null if that BG isn't active. */
export function bgDepth(mode: number, bg: BgNum): Bpp | null {
    return bgMode(mode).layers.find((l) => l.bg === bg)?.bpp ?? null;
}

export interface Diagnostic { ok: boolean; message: string; }

/**
 * Didactic check: does an indexed image with `colorCount` used colours fit
 * background `bg` in `mode`? (The heart of "make the impossible impossible".)
 */
export function validateBgImage(mode: number, bg: BgNum, colorCount: number): Diagnostic {
    const depth = bgDepth(mode, bg);
    if (depth === null) {
        return { ok: false, message: `BG${bg} isn't available in Mode ${mode} (it has ${bgMode(mode).layers.length} layer(s)).` };
    }
    const max = bppColors(depth);
    if (colorCount > max) {
        return { ok: false, message: `BG${bg} in Mode ${mode} is ${depth}bpp — ${max} colours max, but this image uses ${colorCount}.` };
    }
    return { ok: true, message: `OK — ${colorCount}/${max} colours (${depth}bpp) on BG${bg}.` };
}

/** Didactic check for a sprite image against the project's OBSEL pair. */
export function validateSpriteImage(objSize: number, spritePx: number, colorCount: number): Diagnostic {
    const pair = objSizePair(objSize);
    if (spritePx !== pair.small && spritePx !== pair.large) {
        return { ok: false, message: `a ${spritePx}px sprite isn't allowed with OBSEL ${pair.name} — use ${pair.small}px or ${pair.large}px.` };
    }
    const max = bppColors(SPRITE_BPP);
    if (colorCount > max) {
        return { ok: false, message: `sprites are ${SPRITE_BPP}bpp — ${max} colours max, but this uses ${colorCount}.` };
    }
    return { ok: true, message: `OK — ${spritePx}px, ${colorCount}/${max} colours.` };
}
