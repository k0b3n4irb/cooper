// Pure "int is 2 bytes on SNES" hover logic — no `vscode` import, Node-testable.
//
// C2 v2: clangd runs the HOST clang (int=4, long=8), and there is no clang target
// for the 65816, so it silently mis-sizes plain `int`/`long` (docs/clangd.md). This
// surfaces the truth PASSIVELY: hovering a plain `int`/`long` token adds a note that
// on the cc65816 target it is 2/4 bytes (not 4/8) and suggests the fixed-width type.
// Hover-only on purpose — it never adds a (possibly-wrong) diagnostic squiggle, so
// it can't misfire; it just augments clangd's own hover.

/** The plain integer types clangd mis-sizes vs the cc65816 target. `short`/`char`
 *  are the same size on host and target, so they're not footguns. */
interface Footgun { host: number; target: number; suggest: string; }
const FOOTGUNS: Record<string, Footgun> = {
    int: { host: 4, target: 2, suggest: '`u16`/`s16`' },
    long: { host: 8, target: 4, suggest: '`u32`/`s32`' },
};

/** The identifier token under `char` (0-based column) in `line`, or null. */
export function wordAt(line: string, char: number): { word: string; start: number; end: number } | null {
    if (char < 0 || char > line.length) {
        return null;
    }
    const isWord = (c: string): boolean => /[A-Za-z0-9_]/.test(c);
    // if the cursor sits just past the end of a word, still match that word
    let start = char;
    while (start > 0 && isWord(line[start - 1])) {
        start--;
    }
    let end = char;
    while (end < line.length && isWord(line[end])) {
        end++;
    }
    if (start === end) {
        return null;
    }
    return { word: line.slice(start, end), start, end };
}

export interface IntSizeHint { markdown: string; start: number; end: number; }

/**
 * If the token at `char` in `line` is a plain `int`/`long` (that clangd mis-sizes),
 * return the hover markdown + the token range; else null. Word-boundary matching
 * means `interval` or a `u16` typedef never trigger.
 */
export function intSizeHint(line: string, char: number): IntSizeHint | null {
    const w = wordAt(line, char);
    if (!w) {
        return null;
    }
    const fg = FOOTGUNS[w.word];
    if (!fg) {
        return null;
    }
    const markdown = `⚠️ **\`${w.word}\` is ${fg.target} bytes on the SNES** (cc65816), not ${fg.host}. `
        + `clangd runs the host target (\`${w.word}\`=${fg.host}), so its size/overflow/shift hints for a plain \`${w.word}\` may be wrong. `
        + `Prefer the fixed-width types ${fg.suggest} — unambiguous to both clangd and the compiler. _(Cooper — see the \`int\`=2 caveat.)_`;
    return { markdown, start: w.start, end: w.end };
}
