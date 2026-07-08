// Pure snippet-library logic — no `vscode` import, Node-testable.
//
// A3 (roadmap): a data-driven, CI-compiled snippet library. Each snippet in
// `data/snippets.json` is a self-contained, pasteable C fragment tagged with the
// LIB_MODULES it needs and the headers it includes. `Cooper: Insert Snippet…`
// wires the modules into the Makefile and drops the code in. Every snippet is
// compiled against the real SDK headers in CI (the D-050 anti-drift lesson), so
// an API change is a red test, not a user's broken build. First category:
// Collision (the SDK `collision` module — Rect / collideRect / collideTile).

export interface Snippet {
    id: string;
    title: string;
    category: string;
    blurb: string;
    modules: string[];
    includes: string[];
    code: string;
}

/** Parse + validate the snippet catalogue (throws on a malformed entry). */
export function parseSnippets(json: string): Snippet[] {
    const raw = JSON.parse(json);
    if (!Array.isArray(raw)) {
        throw new Error('snippets.json must be an array');
    }
    return raw.map((s, i) => {
        for (const k of ['id', 'title', 'category', 'blurb', 'code'] as const) {
            if (typeof s[k] !== 'string' || !s[k]) {
                throw new Error(`snippet #${i} missing string field '${k}'`);
            }
        }
        for (const k of ['modules', 'includes'] as const) {
            if (!Array.isArray(s[k]) || s[k].some((v: unknown) => typeof v !== 'string')) {
                throw new Error(`snippet #${i} field '${k}' must be a string[]`);
            }
        }
        return s as Snippet;
    });
}

/** Wrap a snippet as a standalone translation unit for `clang -fsyntax-only`. */
export function wrapForCompile(s: Snippet): string {
    const inc = ['snes.h', ...s.includes].map((h) => `#include <${h}>`).join('\n');
    return `${inc}\nvoid _snippet_${s.id.replace(/[^A-Za-z0-9_]/g, '_')}(void) {\n${s.code}}\n`;
}

/**
 * Ensure `LIB_MODULES` in a Makefile contains every module the snippet needs
 * (add the missing ones; create the line before the common.mk include if
 * absent). Idempotent.
 */
export function ensureModules(makefile: string, modules: string[]): string {
    if (modules.length === 0) {
        return makefile;
    }
    const m = /^([ \t]*LIB_MODULES[ \t]*:?=[ \t]*)(.*)$/m.exec(makefile);
    if (!m) {
        return makefile.replace(
            /^([ \t]*include\s+\$\(OPENSNES\)\/make\/common\.mk.*)$/m,
            `LIB_MODULES := ${modules.join(' ')}\n$1`);
    }
    const cur = m[2].trim().split(/\s+/).filter(Boolean);
    const merged = [...cur];
    for (const mod of modules) {
        if (!merged.includes(mod)) {
            merged.push(mod);
        }
    }
    if (merged.length === cur.length) {
        return makefile;
    }
    return makefile.replace(m[0], `${m[1]}${merged.join(' ')}`);
}

/** Which of `includes` are NOT already `#include`d in the C source. */
export function missingIncludes(cText: string, includes: string[]): string[] {
    return includes.filter((h) => !new RegExp(`#\\s*include\\s*[<"]${h.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[>"]`).test(cText));
}

/** 0-based line index of the last `#include` (−1 if none) — where to add more. */
export function lastIncludeLine(cText: string): number {
    const lines = cText.split('\n');
    let last = -1;
    for (let i = 0; i < lines.length; i++) {
        if (/^\s*#\s*include\b/.test(lines[i])) {
            last = i;
        }
    }
    return last;
}

/** The full clipboard/tab text: header comment, includes to add, then the code. */
export function snippetText(s: Snippet): string {
    const inc = s.includes.map((h) => `#include <${h}>`).join('\n');
    return `// --- ${s.title} — inserted by Cooper (Insert Snippet) ---\n`
        + `// needs LIB_MODULES: ${s.modules.join(' ') || '(none)'}  ·  Cooper wired the Makefile for you.\n`
        + (inc ? `// add these at the top of the file if missing:\n${inc}\n\n` : '\n')
        + s.code;
}
