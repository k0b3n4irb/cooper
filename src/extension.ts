import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { detectSdk, renderClangd, isOpenSnesRoot, SdkSource, findProjectDir } from './clangdConfig';
import { resolveLunaPath, lunaPreviewArgs, buildMakeArgs, romTargetFromMakefile } from './build';
import { LunaDebugSession } from './lunaDebug';
import { decodeCgram, renderPaletteHtml, decodeOam, renderOamHtml } from './ppu';
import { decodeTileSheet, tilesToRgba, encodePng, renderVramHtml, bytesPerTile } from './tiles';
import { readIndexedPng, readIndexedPixels, writePalette, writeIndexedPixels, bgr555ToRgb8 } from './pngPalette';
import { renderPaletteEditorHtml } from './paletteEditor';
import { renderTileEditorHtml } from './tileEditor';
import { parseSym } from './sym';
import { buildTreeModel, userFunctions, TreeNode, ProjectInfo } from './sidebar';
import { renderDashboardHtml, DashboardState } from './dashboard';

const execFileAsync = promisify(execFile);

const MAKE_TASK_TYPE = 'cooper-make';

export function activate(context: vscode.ExtensionContext): void {
    const tree = new CooperTreeProvider();
    context.subscriptions.push(
        vscode.commands.registerCommand('cooper.configureClangd', () => configureClangd()),
        vscode.commands.registerCommand('cooper.build', () => runBuild()),
        vscode.commands.registerCommand('cooper.preview', () => previewFrame(context)),
        vscode.commands.registerCommand('cooper.showPalette', () => showPalette()),
        vscode.commands.registerCommand('cooper.showOam', () => showOam()),
        vscode.commands.registerCommand('cooper.showVram', () => showVram()),
        vscode.commands.registerCommand('cooper.refresh', () => tree.refresh()),
        vscode.commands.registerCommand('cooper.home', () => showHome(context)),
        vscode.commands.registerCommand('cooper.openWalkthrough', () =>
            vscode.commands.executeCommand('workbench.action.openWalkthrough', 'opensnes.cooper#cooper.gettingStarted', false)),
        vscode.commands.registerCommand('cooper.debug', () => startLunaDebug(tree.current())),
        vscode.commands.registerCommand('cooper.breakOnSymbol', (name: string) => breakOnSymbol(name)),
        vscode.commands.registerCommand('cooper.editPalette', (uri?: vscode.Uri) => editPalette(uri)),
        vscode.commands.registerCommand('cooper.editTiles', (uri?: vscode.Uri) => editTiles(uri)),
        vscode.window.registerTreeDataProvider('cooperTree', tree),
        vscode.tasks.registerTaskProvider(MAKE_TASK_TYPE, makeTaskProvider()),
        vscode.debug.registerDebugAdapterDescriptorFactory('luna', new LunaDebugAdapterFactory()),
        vscode.debug.registerDebugConfigurationProvider('luna', new LunaConfigProvider()),
        vscode.workspace.onDidOpenTextDocument((doc) => void autoConfigureClangd(doc)),
        vscode.window.onDidChangeActiveTextEditor(() => void tree.refresh()),
        vscode.workspace.onDidSaveTextDocument(() => void tree.refresh()),
    );
    void tree.refresh();
    // Auto-configure C support for any already-open OpenSNES C files.
    for (const editor of vscode.window.visibleTextEditors) {
        void autoConfigureClangd(editor.document);
    }
}

export function deactivate(): void {
    // nothing to clean up
}

// ---------------------------------------------------------------------------
// Cooper sidebar — a clickable tree of project / build / viewers / symbols.
// ---------------------------------------------------------------------------

const EMPTY_PROJECT: ProjectInfo = { projectDir: null, romName: null, romBuilt: false, sdkName: null, functions: [] };

class CooperTreeProvider implements vscode.TreeDataProvider<TreeNode> {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData = this.emitter.event;
    private roots: TreeNode[] = [];
    private info: ProjectInfo = EMPTY_PROJECT;

    current(): ProjectInfo {
        return this.info;
    }

    async refresh(): Promise<void> {
        this.info = await resolveProjectInfo();
        this.roots = buildTreeModel(this.info);
        this.emitter.fire();
    }

    getChildren(node?: TreeNode): TreeNode[] {
        return node ? (node.children ?? []) : this.roots;
    }

    getTreeItem(node: TreeNode): vscode.TreeItem {
        const item = new vscode.TreeItem(
            node.label,
            node.kind === 'category' ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None,
        );
        if (node.description) {
            item.description = node.description;
        }
        if (node.icon) {
            item.iconPath = new vscode.ThemeIcon(node.icon);
        }
        if (node.contextValue) {
            item.contextValue = node.contextValue;
        }
        if (node.commandId) {
            item.command = { command: node.commandId, title: node.label, arguments: node.args };
        }
        return item;
    }
}

/** Locate the OpenSNES project: active file's nearest Makefile, else a workspace scan. */
async function resolveProjectDir(): Promise<string | null> {
    const active = vscode.window.activeTextEditor;
    if (active && active.document.uri.scheme === 'file') {
        const p = findProjectDir(path.dirname(active.document.uri.fsPath));
        if (p) {
            return p;
        }
    }
    // Scan the workspace for a Makefile referencing OPENSNES (handles subfolders).
    const mks = await vscode.workspace.findFiles('**/Makefile', '**/{node_modules,build,dist,.git}/**', 20);
    for (const uri of mks) {
        try {
            if (/(^|\n)[ \t]*OPENSNES\b/.test(fs.readFileSync(uri.fsPath, 'utf8'))) {
                return path.dirname(uri.fsPath);
            }
        } catch {
            // ignore
        }
    }
    return null;
}

async function resolveProjectInfo(): Promise<ProjectInfo> {
    const projectDir = await resolveProjectDir();
    if (!projectDir) {
        return EMPTY_PROJECT;
    }
    let romName: string | null = null;
    let romBuilt = false;
    const mk = path.join(projectDir, 'Makefile');
    if (fs.existsSync(mk)) {
        romName = romTargetFromMakefile(fs.readFileSync(mk, 'utf8'));
        if (romName) {
            romBuilt = fs.existsSync(path.join(projectDir, romName));
        }
    }
    const configured = vscode.workspace.getConfiguration('cooper').get<string>('opensnesPath')?.trim() || undefined;
    const sdk = detectSdk({ configured, projectDir });

    let functions: { name: string; addr: number }[] = [];
    const symPath = romName ? path.join(projectDir, romName.replace(/\.(sfc|smc)$/i, '') + '.sym') : null;
    if (symPath && fs.existsSync(symPath)) {
        try {
            const sym = parseSym(fs.readFileSync(symPath, 'utf8'));
            const texts = fs.readdirSync(projectDir)
                .filter((f) => f.endsWith('.c'))
                .map((f) => { try { return fs.readFileSync(path.join(projectDir, f), 'utf8'); } catch { return ''; } });
            functions = userFunctions(texts, sym);
        } catch {
            // leave functions empty
        }
    }
    return { projectDir, romName, romBuilt, sdkName: sdk ? path.basename(sdk.path) : null, functions };
}

/** Start a luna debug session for the sidebar's resolved project (explicit ROM path). */
function startLunaDebug(info: ProjectInfo): void {
    if (!info.projectDir || !info.romName) {
        void vscode.window.showErrorMessage('Cooper: no OpenSNES project/ROM to debug.');
        return;
    }
    // The ROM need not exist yet — the debug config provider does a -g build first.
    const romPath = path.join(info.projectDir, info.romName);
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(info.projectDir))
        ?? vscode.workspace.workspaceFolders?.[0];
    void vscode.debug.startDebugging(folder, {
        type: 'luna', request: 'launch', name: `Debug ${info.romName}`, program: romPath, stopOnEntry: true,
    });
}

/** Toggle a function breakpoint on a symbol (clicking a symbol in the tree).
 *  Clicking again removes it — and it never adds duplicates. */
function breakOnSymbol(name: string): void {
    const existing = vscode.debug.breakpoints.find(
        (b): b is vscode.FunctionBreakpoint => b instanceof vscode.FunctionBreakpoint && b.functionName === name,
    );
    if (existing) {
        vscode.debug.removeBreakpoints([existing]);
        void vscode.window.showInformationMessage(`Cooper: removed breakpoint on ${name}()`);
    } else {
        vscode.debug.addBreakpoints([new vscode.FunctionBreakpoint(name)]);
        void vscode.window.showInformationMessage(`Cooper: breakpoint set on ${name}() — Continue (F5) to hit it.`);
    }
}

// ---------------------------------------------------------------------------
// Asset editors (C6) — the SNES palette editor.
// ---------------------------------------------------------------------------

/** Resolve an editable indexed PNG: explorer context → active editor → quick-pick. */
async function resolveEditablePng(uri: vscode.Uri | undefined, purpose: string): Promise<string | undefined> {
    if (uri?.fsPath && uri.fsPath.endsWith('.png')) {
        return uri.fsPath;
    }
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (active && active.endsWith('.png')) {
        return active;
    }
    const dir = await resolveProjectDir();
    const pngs = await vscode.workspace.findFiles(
        dir ? new vscode.RelativePattern(dir, '**/*.png') : '**/*.png', '**/node_modules/**', 200);
    if (pngs.length === 0) {
        void vscode.window.showErrorMessage('Cooper: no PNG found in this project to edit.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(
        pngs.map((u) => ({ label: path.basename(u.fsPath), description: vscode.workspace.asRelativePath(u), u })),
        { placeHolder: `Pick an indexed PNG to ${purpose}` });
    return pick?.u.fsPath;
}

/** Edit the palette of an indexed PNG (the source `gfx4snes` consumes) — a BGR555
 *  editor that writes the PNG's PLTE back on Save. */
async function editPalette(uri?: vscode.Uri): Promise<void> {
    const file = await resolveEditablePng(uri, 'edit its SNES palette');
    if (!file) {
        return;
    }
    let palette;
    let pixels: { width: number; height: number; indices: number[] } | undefined;
    try {
        const buf = fs.readFileSync(file);
        palette = readIndexedPng(buf).palette;
        try {
            const px = readIndexedPixels(buf); // live preview (best-effort)
            pixels = { width: px.width, height: px.height, indices: Array.from(px.indices) };
        } catch { /* preview optional — the palette still edits */ }
    } catch (e) {
        void vscode.window.showErrorMessage(`Cooper: ${(e as Error).message}`);
        return;
    }
    const panel = vscode.window.createWebviewPanel(
        'cooperPalette', `Palette: ${path.basename(file)}`, vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = renderPaletteEditorHtml(palette, panel.webview.cspSource, nonce(), { fileName: path.basename(file), pixels });
    panel.webview.onDidReceiveMessage((m: { type?: string; palette?: number[] }) => {
        if (m.type === 'save' && Array.isArray(m.palette)) {
            try {
                const out = writePalette(fs.readFileSync(file), m.palette.map((v) => bgr555ToRgb8(v)));
                fs.writeFileSync(file, out);
                void panel.webview.postMessage({ type: 'saved' });
                void vscode.window.showInformationMessage(`Cooper: palette saved to ${path.basename(file)} — Build to regenerate the .pal.`);
            } catch (e) {
                void vscode.window.showErrorMessage(`Cooper: save failed — ${(e as Error).message}`);
            }
        }
    });
}

/** Edit the pixels of an indexed PNG (tiles/sprites) — a paint grid with an 8×8
 *  tile overlay + sprite-cell guide; writes the PNG's pixels back on Save. */
async function editTiles(uri?: vscode.Uri): Promise<void> {
    const file = await resolveEditablePng(uri, 'edit its tiles/sprites');
    if (!file) {
        return;
    }
    let palette;
    let pixels: { width: number; height: number; indices: number[] };
    try {
        const buf = fs.readFileSync(file);
        palette = readIndexedPng(buf).palette;
        const px = readIndexedPixels(buf);
        pixels = { width: px.width, height: px.height, indices: Array.from(px.indices) };
    } catch (e) {
        void vscode.window.showErrorMessage(`Cooper: ${(e as Error).message}`);
        return;
    }
    const panel = vscode.window.createWebviewPanel(
        'cooperTiles', `Tiles: ${path.basename(file)}`, vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true });
    panel.webview.html = renderTileEditorHtml(pixels, palette, panel.webview.cspSource, nonce(), { fileName: path.basename(file) });
    panel.webview.onDidReceiveMessage((m: { type?: string; indices?: number[] }) => {
        if (m.type === 'save' && Array.isArray(m.indices)) {
            try {
                fs.writeFileSync(file, writeIndexedPixels(fs.readFileSync(file), m.indices));
                void panel.webview.postMessage({ type: 'saved' });
                void vscode.window.showInformationMessage(`Cooper: tiles saved to ${path.basename(file)} — Build to regenerate the .pic.`);
            } catch (e) {
                void vscode.window.showErrorMessage(`Cooper: save failed — ${(e as Error).message}`);
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Build — a `make` task provider + a command that runs the build task.
// ---------------------------------------------------------------------------

function sdkPathFor(projectDir: string): string | undefined {
    const configured = vscode.workspace.getConfiguration('cooper').get<string>('opensnesPath')?.trim() || undefined;
    return detectSdk({ configured, projectDir })?.path;
}

/** A `make` task that runs in `cwd` and passes `OPENSNES=<sdk>` (overriding the
 *  Makefile's wrong relative computation for standalone projects). */
function makeTask(
    target: string | undefined,
    scope: vscode.WorkspaceFolder | vscode.TaskScope,
    cwd: string | undefined,
    sdkPath: string | undefined,
    debug = false,
): vscode.Task {
    const base = target && target !== 'all' ? target : 'build';
    const name = debug ? `${base} (debug)` : base;
    const task = new vscode.Task(
        { type: MAKE_TASK_TYPE, target },
        scope,
        name,
        'cooper',
        // Release build (Build/Run): plain make — byte-identical to the shipped ROM.
        // Debug build (F5): -i/-A + CC65816_G=1 so the .sym/asm carry source-level
        // info (debug metadata perturbs codegen, so it never leaks into a release).
        new vscode.ShellExecution('make', buildMakeArgs(sdkPath, target, debug), {
            ...(cwd ? { cwd } : {}),
            ...(debug ? { env: { CC65816_G: '1' } } : {}),
        }),
        '$cooper-cc',
    );
    if (name === 'build') {
        task.group = vscode.TaskGroup.Build;
    } else if (name === 'clean') {
        task.group = vscode.TaskGroup.Clean;
    }
    return task;
}

/** Run a `make` task and resolve to its success (exit 0). Used to build the -g
 *  ROM just before a debug session so Debug never uses release codegen. */
function runMakeAndWait(
    target: string | undefined,
    projectDir: string,
    sdkPath: string | undefined,
    debug: boolean,
): Promise<boolean> {
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectDir))
        ?? vscode.workspace.workspaceFolders?.[0] ?? vscode.TaskScope.Workspace;
    const task = makeTask(target, folder, projectDir, sdkPath, debug);
    return new Promise<boolean>((resolve) => {
        const disp = vscode.tasks.onDidEndTaskProcess((e) => {
            if (e.execution.task === task) {
                disp.dispose();
                resolve(e.exitCode === 0);
            }
        });
        void vscode.tasks.executeTask(task).then(undefined, () => { disp.dispose(); resolve(false); });
    });
}

function makeTaskProvider(): vscode.TaskProvider {
    return {
        provideTasks: () => {
            const tasks: vscode.Task[] = [];
            for (const folder of vscode.workspace.workspaceFolders ?? []) {
                const dir = folder.uri.fsPath;
                if (fs.existsSync(path.join(dir, 'Makefile'))) {
                    const sdk = sdkPathFor(dir);
                    tasks.push(makeTask(undefined, folder, dir, sdk), makeTask('clean', folder, dir, sdk));
                }
            }
            return tasks;
        },
        resolveTask: (task) => {
            const scope = typeof task.scope === 'object' ? task.scope : vscode.TaskScope.Workspace;
            const dir = typeof task.scope === 'object' ? task.scope.uri.fsPath : undefined;
            return makeTask(task.definition.target as string | undefined, scope, dir, dir ? sdkPathFor(dir) : undefined);
        },
    };
}

async function runBuild(target?: string): Promise<void> {
    const projectDir = await resolveProjectDir();
    if (!projectDir) {
        void vscode.window.showErrorMessage('Cooper: no OpenSNES project (a folder with a Makefile) found in this workspace.');
        return;
    }
    const sdk = sdkPathFor(projectDir);
    if (!sdk) {
        void vscode.window.showErrorMessage('Cooper: set cooper.opensnesPath — the OpenSNES SDK could not be located, so the build can\'t override the Makefile\'s OPENSNES.');
        return;
    }
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(projectDir))
        ?? vscode.workspace.workspaceFolders?.[0]
        ?? vscode.TaskScope.Workspace;
    await vscode.tasks.executeTask(makeTask(target, folder, projectDir, sdk));
}

// ---------------------------------------------------------------------------
// Preview — render a headless luna screenshot of the built ROM and open it.
// ---------------------------------------------------------------------------

/** Render a luna screenshot of the project's ROM; returns the PNG path or null
 *  (errors surfaced). Shared by the Preview command and the dashboard. */
async function generatePreviewPng(context: vscode.ExtensionContext): Promise<string | null> {
    const projectDir = await resolveProjectDir();
    if (!projectDir) {
        void vscode.window.showErrorMessage('Cooper: no OpenSNES project (a folder with a Makefile) found.');
        return null;
    }
    const mk = path.join(projectDir, 'Makefile');
    const romName = fs.existsSync(mk) ? romTargetFromMakefile(fs.readFileSync(mk, 'utf8')) : null;
    if (!romName) {
        void vscode.window.showErrorMessage('Cooper: no TARGET in the Makefile — cannot locate the ROM.');
        return null;
    }
    const romPath = path.join(projectDir, romName);
    if (!fs.existsSync(romPath)) {
        const pick = await vscode.window.showWarningMessage(`Cooper: ${romName} not built yet. Build it first?`, 'Build');
        if (pick === 'Build') {
            await runBuild();
        }
        return null;
    }
    const cfg = vscode.workspace.getConfiguration('cooper');
    const sdk = detectSdk({ configured: cfg.get<string>('opensnesPath')?.trim() || undefined, projectDir });
    const luna = resolveLunaPath({ configured: cfg.get<string>('lunaPath')?.trim() || undefined, sdkPath: sdk?.path });
    if (!luna) {
        void vscode.window.showErrorMessage('Cooper: could not find the luna binary. Set cooper.lunaPath (the binary or its folder), or cooper.opensnesPath.');
        return null;
    }
    const storageDir = context.globalStorageUri.fsPath;
    try { fs.mkdirSync(storageDir, { recursive: true }); } catch { /* surfaced below */ }
    const png = path.join(storageDir, 'preview.png');
    const args = lunaPreviewArgs(romPath, png, {
        steps: cfg.get<number>('preview.steps'),
        forceDisplay: cfg.get<boolean>('preview.forceDisplay'),
    });
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Cooper: rendering ${romName} in luna…` },
        async (): Promise<string | null> => {
            try {
                await execFileAsync(luna, args, { cwd: projectDir });
            } catch (err: unknown) {
                void vscode.window.showErrorMessage(`Cooper: luna preview failed: ${(err as { stderr?: string }).stderr?.trim() || String(err)}`);
                return null;
            }
            return fs.existsSync(png) ? png : null;
        },
    );
}

async function previewFrame(context: vscode.ExtensionContext): Promise<void> {
    const png = await generatePreviewPng(context);
    if (png) {
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(png), vscode.ViewColumn.Beside);
    }
}

// ---------------------------------------------------------------------------
// Cooper Home — the dashboard webview (big buttons, live preview, viewer cards).
// ---------------------------------------------------------------------------

let homePanel: vscode.WebviewPanel | undefined;

function nonce(): string {
    let s = '';
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 24; i++) {
        s += chars[Math.floor(Math.random() * chars.length)];
    }
    return s;
}

async function dashboardState(): Promise<DashboardState> {
    const info = await resolveProjectInfo();
    const cfg = vscode.workspace.getConfiguration('cooper');
    const sdk = info.projectDir ? detectSdk({ configured: cfg.get<string>('opensnesPath')?.trim() || undefined, projectDir: info.projectDir }) : null;
    const luna = resolveLunaPath({ configured: cfg.get<string>('lunaPath')?.trim() || undefined, sdkPath: sdk?.path });
    return {
        hasProject: !!info.projectDir,
        projectName: info.romName ? info.romName.replace(/\.(sfc|smc)$/i, '') : (info.projectDir ? path.basename(info.projectDir) : ''),
        romBuilt: info.romBuilt,
        sdkName: info.sdkName,
        lunaFound: !!luna,
    };
}

async function showHome(context: vscode.ExtensionContext): Promise<void> {
    if (homePanel) {
        homePanel.reveal();
        homePanel.webview.html = renderDashboardHtml(await dashboardState(), homePanel.webview.cspSource, nonce());
        return;
    }
    const panel = vscode.window.createWebviewPanel('cooperHome', 'Cooper: Home', vscode.ViewColumn.Active,
        { enableScripts: true, retainContextWhenHidden: true });
    homePanel = panel;
    panel.onDidDispose(() => { homePanel = undefined; });
    panel.webview.onDidReceiveMessage(async (m: { command?: string }) => {
        switch (m.command) {
            case 'build': await runBuild(); break;
            case 'debug': startLunaDebug((await resolveProjectInfo())); break;
            case 'palette': await showPalette(); break;
            case 'oam': await showOam(); break;
            case 'vram': await showVram(); break;
            case 'run': {
                const png = await generatePreviewPng(context);
                if (png) {
                    const data = fs.readFileSync(png).toString('base64');
                    void panel.webview.postMessage({ type: 'preview', dataUri: `data:image/png;base64,${data}` });
                }
                break;
            }
        }
    });
    panel.webview.html = renderDashboardHtml(await dashboardState(), panel.webview.cspSource, nonce());
}

// ---------------------------------------------------------------------------
// Palette viewer (P2.2c) — a webview of the live CGRAM at a debug stop.
// ---------------------------------------------------------------------------

interface PpuSnapshot { cgram?: number[]; oam?: number[]; }

/** Read the live PPU snapshot from the active luna debug session, or surface an error. */
async function activePpu(): Promise<PpuSnapshot | undefined> {
    const session = vscode.debug.activeDebugSession;
    if (!session || session.type !== 'luna') {
        void vscode.window.showErrorMessage('Cooper: start a Luna debug session (and pause) before opening a viewer.');
        return undefined;
    }
    try {
        return await session.customRequest('cooperPpu') as PpuSnapshot;
    } catch (e) {
        void vscode.window.showErrorMessage(`Cooper: could not read the PPU state: ${String(e)}`);
        return undefined;
    }
}

const viewerPanels = new Map<string, vscode.WebviewPanel>();

/** Reuse (or create) a named webview panel and set its HTML from `render`. */
function showViewer(id: string, title: string, render: (webview: vscode.Webview) => string): void {
    let panel = viewerPanels.get(id);
    if (!panel) {
        panel = vscode.window.createWebviewPanel(id, title, vscode.ViewColumn.Beside, { enableScripts: false });
        panel.onDidDispose(() => viewerPanels.delete(id));
        viewerPanels.set(id, panel);
    }
    panel.webview.html = render(panel.webview);
    panel.reveal(vscode.ViewColumn.Beside);
}

async function showPalette(): Promise<void> {
    const ppu = await activePpu();
    if (!ppu) {
        return;
    }
    const colors = decodeCgram(ppu.cgram ?? []);
    showViewer('cooperPalette', 'CGRAM Palette', (w) => renderPaletteHtml(colors, w.cspSource));
}

async function showOam(): Promise<void> {
    const ppu = await activePpu();
    if (!ppu) {
        return;
    }
    const sprites = decodeOam(ppu.oam ?? []);
    showViewer('cooperOam', 'OAM (sprites)', (w) => renderOamHtml(sprites, w.cspSource));
}

async function showVram(): Promise<void> {
    const session = vscode.debug.activeDebugSession;
    if (!session || session.type !== 'luna') {
        void vscode.window.showErrorMessage('Cooper: start a Luna debug session (and pause) before opening a viewer.');
        return;
    }
    const BPP = 4, TILES_PER_ROW = 16, VRAM_BYTES = 0x4000; // first 512 4bpp tiles
    let cgram: number[] = [];
    let vram: number[] = [];
    try {
        cgram = ((await session.customRequest('cooperPpu')) as { cgram?: number[] }).cgram ?? [];
        vram = ((await session.customRequest('cooperVram', { offset: 0, count: VRAM_BYTES })) as { bytes?: number[] }).bytes ?? [];
    } catch (e) {
        void vscode.window.showErrorMessage(`Cooper: could not read VRAM: ${String(e)}`);
        return;
    }
    const count = Math.floor(vram.length / bytesPerTile(BPP));
    const tiles = decodeTileSheet(vram, BPP, count);
    const palette = decodeCgram(cgram).slice(0, 16); // sub-palette 0
    const { width, height, data } = tilesToRgba(tiles, palette, TILES_PER_ROW);
    const png = encodePng(width, height, data).toString('base64');
    showViewer('cooperVram', 'VRAM tiles',
        (w) => renderVramHtml(png, w.cspSource, `${count} tiles · ${BPP}bpp · palette 0 · ${width}×${height}`, width * 4));
}

// ---------------------------------------------------------------------------
// Debugger (P2.1b) — inline DAP adapter over luna MCP + the WLA .sym.
// ---------------------------------------------------------------------------

class LunaDebugAdapterFactory implements vscode.DebugAdapterDescriptorFactory {
    createDebugAdapterDescriptor(): vscode.ProviderResult<vscode.DebugAdapterDescriptor> {
        // In-process: no separate adapter binary, no TCP port (D-018).
        return new vscode.DebugAdapterInlineImplementation(new LunaDebugSession());
    }
}

class LunaConfigProvider implements vscode.DebugConfigurationProvider {
    async resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
    ): Promise<vscode.DebugConfiguration | undefined> {
        // Use a configured `program` only if it actually exists — a launch.json can
        // go stale when the project is restructured. Otherwise re-resolve the ROM
        // from the project (subfolder-aware), so debugging self-heals.
        let romPath: string | undefined = (config.program && fs.existsSync(config.program)) ? config.program : undefined;
        let projectDir = romPath
            ? path.dirname(romPath)
            : (await resolveProjectDir()) ?? folder?.uri.fsPath
              ?? (vscode.window.activeTextEditor && path.dirname(vscode.window.activeTextEditor.document.uri.fsPath)) ?? undefined;

        if (!projectDir) {
            void vscode.window.showErrorMessage('Cooper: open an OpenSNES project (a folder with a Makefile) to debug.');
            return undefined;
        }
        if (!romPath) {
            const mk = path.join(projectDir, 'Makefile');
            const romName = fs.existsSync(mk) ? romTargetFromMakefile(fs.readFileSync(mk, 'utf8')) : null;
            if (romName) {
                romPath = path.join(projectDir, romName);
            }
        }

        // A bare "F5 with no launch.json": seed a launch config from the project.
        if (!config.type && !config.request && !config.name) {
            config.type = 'luna';
            config.request = 'launch';
            config.name = 'Luna: Debug SNES ROM';
        }

        if (!romPath) {
            void vscode.window.showErrorMessage('Cooper: no ROM to debug — add a Makefile with a TARGET, or set "program" in launch.json.');
            return undefined;
        }
        config.program = romPath;

        const cfg = vscode.workspace.getConfiguration('cooper');
        const sdk = detectSdk({ configured: cfg.get<string>('opensnesPath')?.trim() || undefined, projectDir });

        // Debug = a `-g` (source-level) build. Rebuild now — make is incremental —
        // so Debug always carries debug info and needs no manual Build first, while
        // Build/Run stay release (byte-identical to the shipped ROM). If the SDK
        // can't be located, fall back to whatever ROM already exists.
        if (sdk?.path) {
            const ok = await runMakeAndWait(undefined, projectDir, sdk.path, true);
            if (!ok || !fs.existsSync(romPath)) {
                void vscode.window.showErrorMessage('Cooper: the debug build failed — see the terminal for the make error.');
                return undefined;
            }
        } else if (!fs.existsSync(romPath)) {
            void vscode.window.showErrorMessage(`Cooper: ${path.basename(romPath)} isn't built, and the SDK couldn't be located to build it (set cooper.opensnesPath).`);
            return undefined;
        }

        const luna = resolveLunaPath({ configured: cfg.get<string>('lunaPath')?.trim() || undefined, sdkPath: sdk?.path });
        if (!luna) {
            void vscode.window.showErrorMessage('Cooper: could not find the luna binary. Set cooper.lunaPath (the binary or its folder), or cooper.opensnesPath.');
            return undefined;
        }
        config.lunaPath = luna;
        config.cwd = config.cwd ?? projectDir;
        return config;
    }
}

// ---------------------------------------------------------------------------
// Configure clangd (Component #3) — unchanged logic.
// ---------------------------------------------------------------------------

// Projects auto-configured this session (dedupe; keyed by project dir).
const autoConfigured = new Set<string>();

/**
 * On opening a C file in an OpenSNES project, write a `.clangd` automatically so
 * IntelliSense "just works" — resolving the project from the active file (handles
 * subfolders) and the SDK from the setting/Makefile, with a single picker prompt
 * when the SDK can't be found (out-of-tree projects). Never overwrites an existing
 * `.clangd`; opt out with `cooper.autoConfigureClangd: false`.
 */
async function autoConfigureClangd(doc: vscode.TextDocument): Promise<void> {
    if (doc.languageId !== 'c' || doc.uri.scheme !== 'file') {
        return;
    }
    if (!vscode.workspace.getConfiguration('cooper').get<boolean>('autoConfigureClangd', true)) {
        return;
    }
    const projectDir = findProjectDir(path.dirname(doc.uri.fsPath));
    if (!projectDir || autoConfigured.has(projectDir)) {
        return;
    }
    autoConfigured.add(projectDir);

    const clangdPath = path.join(projectDir, '.clangd');
    if (fs.existsSync(clangdPath)) {
        return; // respect an existing config
    }

    const configured = vscode.workspace.getConfiguration('cooper').get<string>('opensnesPath')?.trim() || undefined;
    let sdk = detectSdk({ configured, projectDir });
    if (!sdk) {
        // OpenSNES project but SDK unknown (out-of-tree / no setting) — ask once.
        const pick = await vscode.window.showInformationMessage(
            'Cooper: point me at the OpenSNES SDK to enable C IntelliSense (completion, go-to-definition).',
            'Choose SDK folder…',
        );
        if (pick !== 'Choose SDK folder…') {
            return;
        }
        const sel = await vscode.window.showOpenDialog({
            canSelectFolders: true, canSelectFiles: false, canSelectMany: false, openLabel: 'Select OpenSNES SDK root',
        });
        const chosen = sel?.[0]?.fsPath;
        if (!chosen) {
            return;
        }
        if (!isOpenSnesRoot(chosen)) {
            void vscode.window.showErrorMessage(`Cooper: ${chosen} is not an OpenSNES SDK root (missing lib/include/snes.h).`);
            return;
        }
        await vscode.workspace.getConfiguration('cooper').update('opensnesPath', chosen, vscode.ConfigurationTarget.Workspace);
        sdk = { path: chosen, source: 'setting' as SdkSource };
    }

    try {
        fs.writeFileSync(clangdPath, renderClangd(sdk.path));
    } catch {
        return; // best-effort; the manual command remains available
    }
    void vscode.window.showInformationMessage('Cooper: C IntelliSense configured. If prompted, install/restart clangd.');
}

async function configureClangd(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        void vscode.window.showErrorMessage('Cooper: open a project folder first.');
        return;
    }
    const projectDir = folder.uri.fsPath;
    const configured = vscode.workspace.getConfiguration('cooper').get<string>('opensnesPath')?.trim() || undefined;

    let detected = detectSdk({ configured, projectDir });

    if (!detected) {
        const pick = await vscode.window.showWarningMessage(
            'Cooper: could not locate the OpenSNES SDK (no cooper.opensnesPath setting, no OPENSNES in a Makefile, none found above this project). Pick the SDK folder?',
            'Choose folder…',
        );
        if (pick !== 'Choose folder…') {
            return;
        }
        const sel = await vscode.window.showOpenDialog({
            canSelectFolders: true,
            canSelectFiles: false,
            canSelectMany: false,
            openLabel: 'Select OpenSNES SDK root',
        });
        const chosen = sel?.[0]?.fsPath;
        if (!chosen) {
            return;
        }
        if (!isOpenSnesRoot(chosen)) {
            void vscode.window.showErrorMessage(`Cooper: ${chosen} is not an OpenSNES SDK root (missing lib/include/snes.h).`);
            return;
        }
        await vscode.workspace.getConfiguration('cooper').update('opensnesPath', chosen, vscode.ConfigurationTarget.Workspace);
        detected = { path: chosen, source: 'setting' as SdkSource };
    }

    const target = path.join(projectDir, '.clangd');
    if (fs.existsSync(target)) {
        const overwrite = await vscode.window.showWarningMessage(
            `Cooper: ${target} already exists. Overwrite it?`,
            'Overwrite',
        );
        if (overwrite !== 'Overwrite') {
            return;
        }
    }

    try {
        fs.writeFileSync(target, renderClangd(detected.path));
    } catch (err) {
        void vscode.window.showErrorMessage(`Cooper: failed to write ${target}: ${String(err)}`);
        return;
    }

    void vscode.window.showInformationMessage(
        `Cooper: wrote .clangd (SDK ${detected.path}, found via ${detected.source}). Restart the clangd language server to pick it up.`,
    );
}
