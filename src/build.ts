// Pure build/preview logic for OpenSNES — no `vscode` import, so it is
// unit-testable under plain Node. The VS Code glue lives in extension.ts.

import * as fs from 'fs';
import * as path from 'path';

/**
 * Parse the output ROM filename from an example/project Makefile's `TARGET` line.
 * Grounded: OpenSNES example Makefiles set `TARGET := <name>.sfc` and the ROM
 * lands in the Makefile's own directory (no build/ subdir). Returns the bare
 * filename (e.g. `aim_target.sfc`) or null if absent/unresolved.
 */
export function romTargetFromMakefile(makefileText: string): string | null {
    const m = makefileText.match(/^[ \t]*TARGET[ \t]*[:?]?=[ \t]*(.+?)[ \t]*$/m);
    if (!m) {
        return null;
    }
    const val = m[1].trim();
    if (val === '' || val.includes('$')) {
        return null; // empty or an unresolved make variable
    }
    return val;
}

export interface RomInfo {
    /** Directory holding the Makefile (the build cwd and where the ROM lands). */
    dir: string;
    /** Absolute path to the output ROM. */
    rom: string;
}

/**
 * Walk up from startDir looking for the nearest Makefile that defines `TARGET`,
 * and return its directory plus the absolute ROM path it produces. OpenSNES
 * examples are self-contained (Makefile + main.c + ROM in one dir), so this
 * resolves a preview target from wherever the active file lives.
 */
export function findRomForDir(startDir: string, maxLevels = 8): RomInfo | null {
    let dir = startDir;
    for (let i = 0; i < maxLevels; i++) {
        const mk = path.join(dir, 'Makefile');
        if (fs.existsSync(mk)) {
            const rom = romTargetFromMakefile(fs.readFileSync(mk, 'utf8'));
            if (rom) {
                return { dir, rom: path.join(dir, rom) };
            }
        }
        const parent = path.dirname(dir);
        if (parent === dir) {
            break;
        }
        dir = parent;
    }
    return null;
}

/**
 * Resolve the luna *binary*. luna is released separately from the SDK, so accept
 * a configured path that is the binary itself OR a directory containing it
 * (`luna`, `bin/luna`, …) — a user release unzips to a folder. Order:
 * `cooper.lunaPath` (file or dir) → the SDK's pinned binary
 * `<sdk>/tools/luna-test/bin/luna` → `luna` on the PATH → null.
 */
export function resolveLunaPath(opts: { configured?: string; sdkPath?: string }): string | null {
    const { configured, sdkPath } = opts;

    const asBinary = (p: string): string | null => {
        try {
            const st = fs.statSync(p);
            if (st.isFile()) {
                return p;
            }
            if (st.isDirectory()) {
                for (const cand of ['luna', path.join('bin', 'luna'), path.join('tools', 'luna-test', 'bin', 'luna')]) {
                    const full = path.join(p, cand);
                    try {
                        if (fs.statSync(full).isFile()) {
                            return full;
                        }
                    } catch { /* next candidate */ }
                }
            }
        } catch { /* not found */ }
        return null;
    };

    if (configured) {
        const r = asBinary(configured);
        if (r) {
            return r;
        }
    }
    if (sdkPath) {
        const r = asBinary(path.join(sdkPath, 'tools', 'luna-test', 'bin', 'luna'));
        if (r) {
            return r;
        }
    }
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!dir) {
            continue;
        }
        try {
            const full = path.join(dir, 'luna');
            if (fs.statSync(full).isFile()) {
                return full;
            }
        } catch { /* next dir */ }
    }
    return null;
}

/**
 * Resolve the `luna-gui` binary (the native play window, `luna-gui <rom>`).
 * Order: inside a configured `cooper.lunaPath` directory → next to the resolved
 * `luna` binary (the release tarball ships both side by side) → `luna-gui` on
 * the PATH → null. (The SDK's pinned harness installs only the CLI, so the
 * sibling lookup usually resolves from the user's unzipped luna release.)
 */
export function resolveLunaGuiPath(opts: { configured?: string; sdkPath?: string }): string | null {
    const exists = (p: string): string | null => {
        try {
            return fs.statSync(p).isFile() ? p : null;
        } catch {
            return null;
        }
    };
    if (opts.configured) {
        try {
            if (fs.statSync(opts.configured).isDirectory()) {
                const r = exists(path.join(opts.configured, 'luna-gui')) ?? exists(path.join(opts.configured, 'bin', 'luna-gui'));
                if (r) {
                    return r;
                }
            }
        } catch { /* not found */ }
    }
    const luna = resolveLunaPath(opts);
    if (luna) {
        const r = exists(path.join(path.dirname(luna), 'luna-gui'));
        if (r) {
            return r;
        }
    }
    for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
        if (!dir) {
            continue;
        }
        const r = exists(path.join(dir, 'luna-gui'));
        if (r) {
            return r;
        }
    }
    return null;
}

// Watch mode (G3): which saved files should trigger a rebuild. Inclusion by
// source extension, MINUS generated artifacts — `make` writes `main.c.asm`,
// `*.wrap.asm`, `*.o`, the ROM… into the project dir, and re-triggering on
// those would loop the watcher forever.
const WATCH_SOURCE_EXTS = ['.c', '.h', '.asm', '.inc', '.png', '.it', '.tmj', '.tmx'];
const WATCH_ARTIFACT_SUFFIXES = ['.c.asm', '.wrap.asm', '.c.o', '.o', '.sfc', '.smc', '.sym', '.dbg', '.pic', '.pal', '.map', '.bnk'];
const WATCH_ARTIFACT_NAMES = new Set(['linkfile', 'project_hdr.asm', 'project_config.inc', 'project_sa1_boot.asm', 'data_init_start.wrap.asm', 'data_init_end.wrap.asm']);

/** Whether a saved file is a build SOURCE (should trigger a watch rebuild). */
export function isWatchSource(fileName: string): boolean {
    const base = fileName.split(/[\\/]/).pop() ?? fileName;
    if (WATCH_ARTIFACT_NAMES.has(base) || WATCH_ARTIFACT_SUFFIXES.some((s) => base.endsWith(s))) {
        return false;
    }
    return WATCH_SOURCE_EXTS.some((e) => base.endsWith(e));
}

export interface PreviewOpts {
    /** CPU instructions before the screenshot (default 200000 — grounded stable). */
    steps?: number;
    /** Bypass INIDISP forced-blank so a blanked title still renders (default true). */
    forceDisplay?: boolean;
    /** Render only one BG layer (1..4); default composited frame. */
    bg?: number;
}

/**
 * Build the argv for a headless `luna run` screenshot preview. Grounded against
 * luna 1.1.0 `run --help`: `-n/--steps`, `--screenshot <png>`, `--force-display`,
 * `--bg <1..4>`, positional `<ROM>` last.
 */
export function lunaPreviewArgs(romPath: string, screenshotPath: string, opts: PreviewOpts = {}): string[] {
    const steps = opts.steps && opts.steps > 0 ? opts.steps : 200000;
    const args = ['run', '--steps', String(steps), '--screenshot', screenshotPath];
    if (opts.forceDisplay !== false) {
        args.push('--force-display');
    }
    if (opts.bg && opts.bg >= 1 && opts.bg <= 4) {
        args.push('--bg', String(opts.bg));
    }
    args.push(romPath);
    return args;
}

/**
 * Build the `make` argv. Passes `OPENSNES=<sdk>` so the build uses the SDK Cooper
 * resolved (the setting), **overriding** the Makefile's own
 * `OPENSNES := $(shell cd ../../.. && pwd)` — which only works when the project
 * lives inside the SDK's `examples/` tree, and is wrong for a standalone project.
 * (A command-line variable overrides a makefile `:=` assignment in GNU make.)
 * Empty target = the default goal (builds the ROM).
 *
 * `debug` selects a **debug build**: it adds `wla -i` + `wlalink -A` so the `.sym`
 * carries PC→line info. Paired with `CC65816_G=1` (set on the task env) it yields
 * source-level debug info. A **release build** (`debug=false`, the default for
 * Build/Run) omits both, so it is byte-identical to the shipped/optimised ROM —
 * debug metadata perturbs codegen, so it must not leak into a normal build.
 */
export function buildMakeArgs(sdkPath?: string, target?: string, debug = false): string[] {
    const args: string[] = [];
    if (sdkPath) {
        args.push(`OPENSNES=${sdkPath}`);
        if (debug) {
            args.push(`AS=${path.join(sdkPath, 'bin', 'wla-65816')} -i`);
            args.push(`LD=${path.join(sdkPath, 'bin', 'wlalink')} -A`);
        }
    }
    if (target && target !== 'all') {
        args.push(target);
    }
    return args;
}
