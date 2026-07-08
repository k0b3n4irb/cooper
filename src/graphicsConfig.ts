// Resolve the project's graphics config — no `vscode` import, Node-testable.
//
// Hybrid model (user decision, 2026-07-08): the DEFAULT is read from the code's
// own `setMode(...)` / `oamInit(...)` calls (the code is the truth), and a
// `.cooper/graphics.json` override wins when present. Every resolved field
// carries its provenance so the UI can say "Mode 1 (from your setMode call)"
// vs "(from .cooper/graphics.json)".

import { GraphicsConfig, DEFAULT_GRAPHICS } from './snesModes';

export const GRAPHICS_CONFIG_REL = '.cooper/graphics.json';

/** OBJ_SIZE_* macro → OBSEL id (order = the sprite.h #define values). */
const OBJ_SIZE_NAME_TO_ID: Record<string, number> = {
    OBJ_SIZE8_L16: 0, OBJ_SIZE8_L32: 1, OBJ_SIZE8_L64: 2,
    OBJ_SIZE16_L32: 3, OBJ_SIZE16_L64: 4, OBJ_SIZE32_L64: 5,
};

/** Best-effort read of `{mode?, objSize?}` from C source (first call wins). */
export function parseGraphicsFromCode(cText: string): Partial<GraphicsConfig> {
    const out: Partial<GraphicsConfig> = {};

    // setMode(BG_MODEn, …) or setMode(n, …)
    const mode = /\bsetMode\s*\(\s*(?:BG_MODE([0-7])|([0-7]))\b/.exec(cText);
    if (mode) {
        out.mode = Number(mode[1] ?? mode[2]);
    }

    // oamInit(OBJ_SIZE*, …) / oamInit(n, …), or a `.sizeMode = OBJ_SIZE*` field
    const oam = /\boamInit\s*\(\s*(OBJ_SIZE\w+|[0-5])\b/.exec(cText)
        ?? /\.sizeMode\s*=\s*(OBJ_SIZE\w+|[0-5])\b/.exec(cText);
    if (oam) {
        const tok = oam[1];
        const id = /^[0-5]$/.test(tok) ? Number(tok) : OBJ_SIZE_NAME_TO_ID[tok];
        if (id !== undefined) {
            out.objSize = id;
        }
    }
    return out;
}

/** Parse + range-validate a `.cooper/graphics.json` override; throws on garbage. */
export function parseOverride(json: string): Partial<GraphicsConfig> {
    const o = JSON.parse(json) as { mode?: unknown; objSize?: unknown };
    const out: Partial<GraphicsConfig> = {};
    if (o.mode !== undefined) {
        if (!Number.isInteger(o.mode) || (o.mode as number) < 0 || (o.mode as number) > 7) {
            throw new Error('mode must be an integer 0..7');
        }
        out.mode = o.mode as number;
    }
    if (o.objSize !== undefined) {
        if (!Number.isInteger(o.objSize) || (o.objSize as number) < 0 || (o.objSize as number) > 5) {
            throw new Error('objSize must be an integer 0..5');
        }
        out.objSize = o.objSize as number;
    }
    return out;
}

export type Provenance = 'default' | 'code' | 'override';

export interface ResolvedGraphics {
    config: GraphicsConfig;
    source: { mode: Provenance; objSize: Provenance };
}

/**
 * Merge, lowest→highest precedence: built-in default → code-derived (the first
 * source file that yields each field) → the override file. Returns the config
 * plus where each field came from.
 */
export function resolveGraphics(codeTexts: string[], overrideJson?: string): ResolvedGraphics {
    const config: GraphicsConfig = { ...DEFAULT_GRAPHICS };
    const source: { mode: Provenance; objSize: Provenance } = { mode: 'default', objSize: 'default' };

    for (const text of codeTexts) {
        const c = parseGraphicsFromCode(text);
        if (c.mode !== undefined && source.mode === 'default') {
            config.mode = c.mode;
            source.mode = 'code';
        }
        if (c.objSize !== undefined && source.objSize === 'default') {
            config.objSize = c.objSize;
            source.objSize = 'code';
        }
    }

    if (overrideJson && overrideJson.trim()) {
        const ov = parseOverride(overrideJson);
        if (ov.mode !== undefined) {
            config.mode = ov.mode;
            source.mode = 'override';
        }
        if (ov.objSize !== undefined) {
            config.objSize = ov.objSize;
            source.objSize = 'override';
        }
    }
    return { config, source };
}

/** Serialize an override file (pretty, with a hint comment-free JSON body). */
export function serializeOverride(config: GraphicsConfig): string {
    return JSON.stringify({ mode: config.mode, objSize: config.objSize }, null, 2) + '\n';
}
