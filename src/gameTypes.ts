// Game-type presets loader — no `vscode` import, Node-testable.
//
// The presets themselves live in `data/gameTypes.json` (editable data, shipped
// in the vsix) so the catalogue evolves without recompiling. This module parses
// + validates it into the shape the New Game wizard and the Makefile generator
// consume. Each type prefills sensible SNES defaults (mode, sprite sizes, chips,
// lib modules); the user adjusts anything, or picks "custom".

import { GraphicsConfig } from './snesModes';

/** Maps to the Makefile USE_* knobs. `sound` is on by default across all types. */
export interface GameTypeBuild {
    sound: boolean;
    sram?: boolean;
    hirom?: boolean;
    fastrom?: boolean;
    sa1?: boolean;
    superfx?: boolean;
}

export interface GameType {
    id: string;
    name: string;
    blurb: string;
    graphics: GraphicsConfig; // { mode 0..7, objSize 0..5 }
    build: GameTypeBuild;
    /** Graphics/logic LIB_MODULES (deps auto-resolve; flag-driven modules —
     *  snesmod/sram/superfx/sa1 — come from `build`, not this list). */
    modules: string[];
    /** The freeform starter (minimal defaults, no genre assumptions). */
    custom?: boolean;
}

function bad(msg: string): never {
    throw new Error(`gameTypes.json: ${msg}`);
}

/** Parse + validate the presets file. Throws with a clear message on garbage. */
export function parseGameTypes(json: string): GameType[] {
    const doc = JSON.parse(json) as { types?: unknown };
    if (!Array.isArray(doc.types) || !doc.types.length) {
        bad('missing a non-empty "types" array');
    }
    const seen = new Set<string>();
    return (doc.types as unknown[]).map((raw, i) => {
        const t = raw as Partial<GameType> & { graphics?: Partial<GraphicsConfig>; build?: Partial<GameTypeBuild> };
        if (typeof t.id !== 'string' || !/^[a-z0-9_-]+$/.test(t.id)) {
            bad(`type #${i}: id must be a slug`);
        }
        if (seen.has(t.id)) {
            bad(`duplicate id "${t.id}"`);
        }
        seen.add(t.id);
        if (typeof t.name !== 'string' || typeof t.blurb !== 'string') {
            bad(`type "${t.id}": name and blurb are required`);
        }
        const mode = t.graphics?.mode;
        const objSize = t.graphics?.objSize;
        if (!Number.isInteger(mode) || (mode as number) < 0 || (mode as number) > 7) {
            bad(`type "${t.id}": graphics.mode must be 0..7`);
        }
        if (!Number.isInteger(objSize) || (objSize as number) < 0 || (objSize as number) > 5) {
            bad(`type "${t.id}": graphics.objSize must be 0..5`);
        }
        if (typeof t.build?.sound !== 'boolean') {
            bad(`type "${t.id}": build.sound must be a boolean`);
        }
        if (!Array.isArray(t.modules) || !t.modules.length || !t.modules.every((m) => typeof m === 'string')) {
            bad(`type "${t.id}": modules must be a non-empty string array`);
        }
        return {
            id: t.id,
            name: t.name,
            blurb: t.blurb,
            graphics: { mode: mode as number, objSize: objSize as number },
            build: {
                sound: t.build.sound,
                sram: !!t.build.sram,
                hirom: !!t.build.hirom,
                fastrom: !!t.build.fastrom,
                sa1: !!t.build.sa1,
                superfx: !!t.build.superfx,
            },
            modules: t.modules as string[],
            ...(t.custom ? { custom: true } : {}),
        };
    });
}
