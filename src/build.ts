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
 * Resolve the luna binary: explicit `cooper.lunaPath` setting → the SDK's pinned
 * binary at `<sdk>/tools/luna-test/bin/luna` (grounded; v1.1.0) → null.
 */
export function resolveLunaPath(opts: { configured?: string; sdkPath?: string }): string | null {
    const { configured, sdkPath } = opts;
    if (configured && fs.existsSync(configured)) {
        return configured;
    }
    if (sdkPath) {
        const p = path.join(sdkPath, 'tools', 'luna-test', 'bin', 'luna');
        if (fs.existsSync(p)) {
            return p;
        }
    }
    return null;
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

/** Build the `make` argv for a target (empty = default goal, which builds the ROM). */
export function makeArgs(target?: string): string[] {
    return target && target !== 'all' ? [target] : [];
}
