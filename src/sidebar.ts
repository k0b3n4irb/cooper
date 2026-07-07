// Pure model for the Cooper sidebar tree — no `vscode` import, Node-testable.
// The TreeDataProvider in extension.ts maps these nodes to vscode.TreeItems.

import { SymTable, symbolToAddr } from './sym';

export type NodeKind = 'category' | 'action' | 'info' | 'symbol';

export interface TreeNode {
    id: string;
    label: string;
    kind: NodeKind;
    /** Right-aligned muted text. */
    description?: string;
    /** Codicon id (e.g. 'play', 'debug-alt', 'symbol-function'). */
    icon?: string;
    /** Command id to run when the node is clicked. */
    commandId?: string;
    /** Arguments passed to the command. */
    args?: unknown[];
    children?: TreeNode[];
    contextValue?: string;
}

export interface ProjectInfo {
    projectDir: string | null;
    romName: string | null;
    romBuilt: boolean;
    /** Basename of the SDK directory, or null if not located. */
    sdkName: string | null;
    functions: { name: string; addr: number }[];
}

function hex24(addr: number): string {
    return '$' + (addr >>> 0).toString(16).toUpperCase().padStart(6, '0');
}

/**
 * Extract C function-definition names from source text. Intentionally loose
 * (the `.sym` is the source of truth — see `userFunctions`); matches the common
 * `[static] <type> name(args) {` header with the brace on the same line.
 */
export function extractCFunctions(cText: string): string[] {
    const names: string[] = [];
    const re = /^(?:static\s+|inline\s+)*[A-Za-z_][\w\s*]*?\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cText)) !== null) {
        names.push(m[1]);
    }
    return names;
}

/**
 * 0-based document lines of the definitions of `names` in a C source (same
 * loose header match as `extractCFunctions`). Feeds the CodeLens provider.
 */
export function functionDefLines(cText: string, names: ReadonlySet<string>): { name: string; line: number }[] {
    const out: { name: string; line: number }[] = [];
    const re = /^(?:static\s+|inline\s+)*[A-Za-z_][\w\s*]*?\b([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(cText)) !== null) {
        if (names.has(m[1])) {
            out.push({ name: m[1], line: cText.slice(0, m.index).split('\n').length - 1 });
        }
    }
    return out;
}

/**
 * The user's own functions: C function names that actually made it into the ROM
 * (present in the `.sym`). Returns {name, addr} sorted by address (≈ source order).
 */
export function userFunctions(cTexts: string[], sym: SymTable): { name: string; addr: number }[] {
    const seen = new Map<string, number>();
    for (const text of cTexts) {
        for (const name of extractCFunctions(text)) {
            if (seen.has(name)) {
                continue;
            }
            const addr = symbolToAddr(sym, name);
            if (addr !== undefined) {
                seen.set(name, addr);
            }
        }
    }
    return [...seen.entries()].map(([name, addr]) => ({ name, addr })).sort((a, b) => a.addr - b.addr);
}

/** Build the top-level Cooper tree from resolved project info. */
export function buildTreeModel(p: ProjectInfo): TreeNode[] {
    if (!p.projectDir) {
        return [{
            id: 'none', kind: 'info', icon: 'info',
            label: 'Open an OpenSNES project (a folder with a Makefile).',
        }];
    }
    const cat = (id: string, label: string, children: TreeNode[]): TreeNode =>
        ({ id, label, kind: 'category', children });
    const action = (id: string, label: string, icon: string, commandId: string): TreeNode =>
        ({ id, label, kind: 'action', icon, commandId });

    return [
        cat('project', 'PROJECT', [
            {
                id: 'rom', kind: 'info', icon: 'file-binary',
                label: p.romName ?? '(no TARGET in Makefile)',
                description: p.romName ? (p.romBuilt ? '✓ built' : 'not built') : undefined,
            },
            { id: 'sdk', kind: 'info', icon: 'folder', label: `SDK: ${p.sdkName ?? 'not found'}` },
        ]),
        cat('run', 'BUILD & RUN', [
            action('build', 'Build (make)', 'play', 'cooper.build'),
            action('preview', 'Run / Preview', 'device-camera', 'cooper.preview'),
            action('play', 'Play (luna-gui)', 'game', 'cooper.play'),
            action('debug', 'Debug', 'debug-alt', 'cooper.debug'),
        ]),
        cat('viewers', 'PPU VIEWERS', [
            action('memmap', 'Memory Map (WRAM/VRAM)', 'graph', 'cooper.showMemoryMap'),
            action('palette', 'Palette (CGRAM)', 'symbol-color', 'cooper.showPalette'),
            action('oam', 'Sprites (OAM)', 'preview', 'cooper.showOam'),
            action('vram', 'Tiles (VRAM)', 'layout', 'cooper.showVram'),
        ]),
        cat('symbols', 'SYMBOLS', p.functions.length
            ? p.functions.map((f) => ({
                id: `sym:${f.name}`, kind: 'symbol' as NodeKind, label: f.name,
                icon: 'symbol-function', description: hex24(f.addr),
                commandId: 'cooper.breakOnSymbol', args: [f.name], contextValue: 'cooperSymbol',
            }))
            : [{ id: 'nosym', kind: 'info' as NodeKind, icon: 'info', label: 'Build to load symbols.' }]),
    ];
}
