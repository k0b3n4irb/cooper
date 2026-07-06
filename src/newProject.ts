// Pure logic for `Cooper: New Project` — no `vscode` import, Node-testable.
//
// A new project is a copy of a real SDK example taken OUT of the SDK tree
// (Cooper embeds NO templates of its own — the SDK's examples are the always-
// current starting points; D-050), with its Makefile rewritten to:
//   - `OPENSNES ?= <sdk>`  (absolute; plain `make` works in a terminal, and
//     Cooper's detectSdk parses this form),
//   - `TARGET := <name>.sfc` and `ROM_NAME := <NAME>` from the project name.
// Build artifacts are excluded from the copy — the list mirrors the SDK's own
// `make clean` (make/common.mk) plus Cooper's `.dbg` sidecars.

import * as fs from 'fs';
import * as path from 'path';

export interface ExampleRef {
    /** Path relative to `<sdk>/examples`, e.g. `games/breakout`. */
    id: string;
    /** Absolute directory. */
    dir: string;
}

/** Valid project name: letters/digits/`_`/`-`, starting with a letter/digit. */
export function validateProjectName(name: string): string | undefined {
    if (!/^[A-Za-z0-9][\w-]*$/.test(name)) {
        return 'letters, digits, _ and - only (must start with a letter or digit)';
    }
    return undefined;
}

/** List the SDK examples usable as starting points: directories under
 *  `<sdk>/examples` whose Makefile includes the shared `common.mk` rules. */
export function listExamples(sdkPath: string): ExampleRef[] {
    const root = path.join(sdkPath, 'examples');
    const out: ExampleRef[] = [];
    const walk = (dir: string, depth: number): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        // An example = a dir whose Makefile includes the shared common.mk rules.
        // (examples/ itself has a build-all orchestrator Makefile — NOT an
        // example: keep walking through anything else.)
        const mk = path.join(dir, 'Makefile');
        try {
            if (fs.existsSync(mk) && /include\s+.*common\.mk/.test(fs.readFileSync(mk, 'utf8'))) {
                out.push({ id: path.relative(root, dir).split(path.sep).join('/'), dir });
                return; // an example dir doesn't nest further examples
            }
        } catch { /* unreadable Makefile: not a starting point */ }
        if (depth >= 4) {
            return;
        }
        for (const e of entries) {
            if (e.isDirectory()) {
                walk(path.join(dir, e.name), depth + 1);
            }
        }
    };
    walk(root, 0);
    return out.sort((a, b) => a.id.localeCompare(b.id));
}

// Generated files, mirroring `make clean` in make/common.mk (+ Cooper's .dbg).
const ARTIFACT_SUFFIXES = ['.o', '.sfc', '.smc', '.sym', '.dbg', '.bnk', '.wrap.asm', '.c.asm', '.sfx.link'];
const ARTIFACT_NAMES = new Set(['linkfile', 'project_hdr.asm', 'project_config.inc', 'project_sa1_boot.asm']);

/** Whether a file is a build artifact (never copied into a new project). */
export function isBuildArtifact(name: string): boolean {
    return ARTIFACT_NAMES.has(name) || ARTIFACT_SUFFIXES.some((s) => name.endsWith(s));
}

/** Rewrite an example's Makefile for its out-of-tree life. */
export function rewriteMakefile(text: string, projectName: string, sdkPath: string): string {
    const romName = projectName.toUpperCase().replace(/[^A-Z0-9 _-]/g, ' ').slice(0, 21).trim() || 'SNES GAME';
    return text
        .replace(/^[ \t]*OPENSNES[ \t]*[:?]?=[ \t]*.+$/m, `OPENSNES ?= ${sdkPath}`)
        .replace(/^([ \t]*TARGET[ \t]*:?=[ \t]*).+$/m, `$1${projectName}.sfc`)
        .replace(/^([ \t]*ROM_NAME[ \t]*:?=[ \t]*).+$/m, `$1${romName}`);
}

/** Copy `exampleDir` → `destDir` (recursive), skipping build artifacts and
 *  rewriting the top-level Makefile. Returns the copied file count.
 *  `destDir` must not already exist (checked by the caller for UX, enforced
 *  here for safety). */
export function scaffoldProject(exampleDir: string, destDir: string, projectName: string, sdkPath: string): number {
    if (fs.existsSync(destDir)) {
        throw new Error(`${destDir} already exists`);
    }
    let copied = 0;
    const copyDir = (from: string, to: string, top: boolean): void => {
        fs.mkdirSync(to, { recursive: true });
        for (const e of fs.readdirSync(from, { withFileTypes: true })) {
            const src = path.join(from, e.name);
            if (e.isDirectory()) {
                copyDir(src, path.join(to, e.name), false);
                continue;
            }
            if (!e.isFile() || isBuildArtifact(e.name)) {
                continue;
            }
            if (top && e.name === 'Makefile') {
                fs.writeFileSync(path.join(to, e.name), rewriteMakefile(fs.readFileSync(src, 'utf8'), projectName, sdkPath));
            } else {
                fs.copyFileSync(src, path.join(to, e.name));
            }
            copied++;
        }
    };
    copyDir(exampleDir, destDir, true);
    return copied;
}
