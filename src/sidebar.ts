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
    /** Categories only: start collapsed (progressive disclosure — the pro bench). */
    collapsed?: boolean;
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
        // No dead-end: the guided ways in, clickable right here.
        return [
            { id: 'newgame', kind: 'action', icon: 'game', label: '🎮 New Game (guided)…', commandId: 'cooper.createNewGame' },
            { id: 'newproject', kind: 'action', icon: 'new-folder', label: '✨ New Project (from an SDK example)…', commandId: 'cooper.newProject' },
            {
                id: 'none', kind: 'info', icon: 'info',
                label: '…or open an OpenSNES project (a folder with a Makefile).',
            },
        ];
    }
    const cat = (id: string, label: string, children: TreeNode[], collapsed = false): TreeNode =>
        ({ id, label, kind: 'category', children, ...(collapsed ? { collapsed } : {}) });
    const action = (id: string, label: string, icon: string, commandId: string): TreeNode =>
        ({ id, label, kind: 'action', icon, commandId });

    // The tree tells the story of MAKING a game (UX-1, D-079): create → run →
    // debug → test & ship → AI. The pro bench (DEBUG) starts collapsed —
    // progressive disclosure; the 10% unfold it once and VS Code remembers.
    return [
        cat('project', 'MY GAME', [
            {
                id: 'rom', kind: 'info', icon: 'file-binary',
                label: p.romName ?? '(no TARGET in Makefile)',
                description: p.romName ? (p.romBuilt ? '✓ built' : 'not built') : undefined,
            },
            { id: 'sdk', kind: 'info', icon: 'folder', label: `SDK: ${p.sdkName ?? 'not found'}` },
            action('newgame', 'New Game (guided)…', 'add', 'cooper.createNewGame'),
        ]),
        cat('create', 'CREATE', [
            action('newsprite', 'New Sprite (draw one)…', 'edit', 'cooper.newSprite'),
            action('newsound', 'New Sound Effect (synth)…', 'music', 'cooper.newSoundEffect'),
            action('addsprite', 'Add Sprite (from a PNG)…', 'file-media', 'cooper.addSprite'),
            action('addsound', 'Add Sound Effect (from a WAV)…', 'unmute', 'cooper.addSoundEffect'),
            action('editpalette', 'Edit Palette', 'symbol-color', 'cooper.editPalette'),
            action('edittiles', 'Edit Tiles', 'paintcan', 'cooper.editTiles'),
            action('addsnippet', 'Add Snippet (collision, …)…', 'symbol-snippet', 'cooper.insertSnippet'),
            action('gfxmode', 'Set Graphics Mode…', 'settings', 'cooper.setGraphicsMode'),
        ]),
        cat('run', 'RUN', [
            action('build', 'Build', 'package', 'cooper.build'),
            action('preview', 'Run Preview', 'device-camera', 'cooper.preview'),
            action('play', 'Play (native window)', 'game', 'cooper.play'),
            action('watch', 'Toggle Watch (rebuild on save)', 'eye', 'cooper.watch'),
        ]),
        cat('debug', 'DEBUG', [
            action('debug', 'Debug', 'debug-alt', 'cooper.debug'),
            action('disasm', 'Show Disassembly', 'file-code', 'cooper.showDisasm'),
            action('memmap', 'Memory Map (WRAM/VRAM)', 'graph', 'cooper.showMemoryMap'),
            action('trace', 'Trace Memory Access…', 'pulse', 'cooper.traceMemory'),
            action('profile', 'Run Profiler (one frame)', 'dashboard', 'cooper.profileFrame'),
            action('palette', 'Palette (CGRAM)', 'symbol-color', 'cooper.showPalette'),
            action('oam', 'Sprites (OAM)', 'preview', 'cooper.showOam'),
            action('vram', 'Tiles (VRAM)', 'layout', 'cooper.showVram'),
        ], true),
        cat('ship', 'TEST & SHIP', [
            action('rectest', 'Record Gameplay Test…', 'record', 'cooper.recordGameplayTest'),
            action('runtests', 'Run Gameplay Tests', 'beaker', 'cooper.runGameplayTests'),
            action('validate', 'Validate ROM', 'verified', 'cooper.validateRom'),
            action('deploy', 'Deploy ROM (to flashcart)…', 'rocket', 'cooper.deployRom'),
        ], true),
        cat('ai', 'AI', [
            action('configai', 'Configure AI (OpenSNES context)', 'sparkle', 'cooper.configureAI'),
        ], true),
        cat('symbols', 'SYMBOLS', p.functions.length
            ? p.functions.map((f) => ({
                id: `sym:${f.name}`, kind: 'symbol' as NodeKind, label: f.name,
                icon: 'symbol-function', description: hex24(f.addr),
                commandId: 'cooper.breakOnSymbol', args: [f.name], contextValue: 'cooperSymbol',
            }))
            : [{ id: 'nosym', kind: 'info' as NodeKind, icon: 'info', label: 'Build to load symbols.' }]),
    ];
}
