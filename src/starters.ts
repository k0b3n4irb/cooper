// Pure starter-catalogue logic — no `vscode` import, Node-testable.
//
// A3: per-genre rich starters. Create New Game generates a project whose starter
// already shows a CONTROLLABLE placeholder sprite on a genre-tinted backdrop —
// "New Game → Run → you're already moving something", not a black screen
// (dogfood friction F3/F13). The per-genre flavour (move axes, backdrop, a
// next-step hint) lives here as data; the placeholder art is data/starters/hero.png,
// wired through the same Add-Sprite pipeline so gfx4snes handles the tile layout.

export type Move = 'horizontal' | 'fourway';

export interface Starter {
    genre: string;
    move: Move;
    backdrop: [number, number, number]; // 5-bit RGB (0..31), for setColor(0, RGB(...))
    hint: string;
}

/** A neutral fallback for a genre with no entry (e.g. an unknown/custom id). */
export const DEFAULT_STARTER: Starter = { genre: 'custom', move: 'fourway', backdrop: [8, 8, 10], hint: 'Add Sprite, Add Sound, and Insert Snippet build it up.' };

/** Parse + validate the starter catalogue (throws on a malformed entry). */
export function parseStarters(json: string): Starter[] {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) {
        throw new Error('starters.json must be an array');
    }
    return raw.map((s, i) => {
        if (typeof s.genre !== 'string' || !s.genre) {
            throw new Error(`starter #${i} missing 'genre'`);
        }
        if (s.move !== 'horizontal' && s.move !== 'fourway') {
            throw new Error(`starter '${s.genre}' has invalid move '${s.move}'`);
        }
        if (!Array.isArray(s.backdrop) || s.backdrop.length !== 3
            || s.backdrop.some((v: unknown) => typeof v !== 'number' || v < 0 || v > 31)) {
            throw new Error(`starter '${s.genre}' backdrop must be 3 numbers in 0..31`);
        }
        if (typeof s.hint !== 'string') {
            throw new Error(`starter '${s.genre}' missing 'hint'`);
        }
        return s as Starter;
    });
}

/** The starter for a genre id, or the neutral default (never throws). */
export function starterFor(starters: Starter[], genre: string): Starter {
    return starters.find((s) => s.genre === genre) ?? DEFAULT_STARTER;
}
