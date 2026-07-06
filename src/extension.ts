import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { detectSdk, renderClangd, isOpenSnesRoot, SdkSource, findProjectDir } from './clangdConfig';
import { resolveLunaPath, lunaPreviewArgs, buildMakeArgs, romTargetFromMakefile } from './build';
import { LunaDebugSession } from './lunaDebug';
import { LunaMcp } from './lunaMcp';
import { decodeCgram, renderPaletteHtml, decodeOam, renderOamHtml } from './ppu';
import { decodeTileSheet, tilesToRgba, encodePng, renderVramHtml, bytesPerTile } from './tiles';
import { readIndexedPng, readIndexedPixels, writePalette, writeIndexedPixels, bgr555ToRgb8 } from './pngPalette';
import { renderPaletteEditorHtml } from './paletteEditor';
import { renderTileEditorHtml } from './tileEditor';
import { parseTilemapEntries, assembleTilemapRgba } from './tilemap';
import { renderAgentsMd, renderCopilotInstructions } from './aiContext';
import { mergeVscodeMcp, mergeProjectMcp } from './mcpConfig';
import { parseSym } from './sym';
import { buildTreeModel, userFunctions, TreeNode, ProjectInfo } from './sidebar';
import { renderDashboardHtml, DashboardState } from './dashboard';

const execFileAsync = promisify(execFile);

const MAKE_TASK_TYPE = 'cooper-make';

// The "Cooper" output channel — the support log. Every subprocess (make, luna,
// MCP), every timeout and every surfaced error lands here so "nothing happens"
// is always diagnosable (View → Output → Cooper, or `Cooper: Show Log`).
let output: vscode.OutputChannel | undefined;

/** Append a timestamped line to the Cooper log. */
function log(msg: string): void {
    output?.appendLine(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

/** Log an error and toast it to the user. `msg` without the "Cooper: " prefix. */
function fail(msg: string): void {
    log(`ERROR: ${msg}`);
    void vscode.window.showErrorMessage(`Cooper: ${msg}`);
}

export function activate(context: vscode.ExtensionContext): void {
    output = vscode.window.createOutputChannel('Cooper');
    log(`Cooper activated (v${(context.extension.packageJSON as { version?: string }).version ?? '?'})`);
    const tree = new CooperTreeProvider();
    context.subscriptions.push(
        output,
        vscode.commands.registerCommand('cooper.showLog', () => output?.show(true)),
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
        vscode.commands.registerCommand('cooper.breakOnSymbol', (name?: string) => breakOnSymbol(name)),
        vscode.commands.registerCommand('cooper.editPalette', (uri?: vscode.Uri) => editPalette(uri)),
        vscode.commands.registerCommand('cooper.editTiles', (uri?: vscode.Uri) => editTiles(uri)),
        vscode.commands.registerCommand('cooper.viewTilemap', (uri?: vscode.Uri) => viewTilemap(uri)),
        vscode.commands.registerCommand('cooper.configureAI', () => configureAI()),
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
async function breakOnSymbol(name?: string): Promise<void> {
    if (!name) {
        // Palette invocation (no tree argument): pick among the project's functions.
        const info = await resolveProjectInfo();
        if (!info.functions.length) {
            fail('no project functions found (open an OpenSNES project with a built .sym).');
            return;
        }
        const picked = await vscode.window.showQuickPick(info.functions.map((f) => f.name), {
            placeHolder: 'Toggle a breakpoint on which function?',
        });
        if (!picked) {
            return;
        }
        name = picked;
    }
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

/** Resolve a project file of a given extension: explorer context → active editor
 *  → quick-pick over the project. */
async function resolveProjectFile(uri: vscode.Uri | undefined, ext: string, purpose: string): Promise<string | undefined> {
    if (uri?.fsPath && uri.fsPath.endsWith(ext)) {
        return uri.fsPath;
    }
    const active = vscode.window.activeTextEditor?.document.uri.fsPath;
    if (active && active.endsWith(ext)) {
        return active;
    }
    const dir = await resolveProjectDir();
    const found = await vscode.workspace.findFiles(
        dir ? new vscode.RelativePattern(dir, `**/*${ext}`) : `**/*${ext}`, '**/node_modules/**', 400);
    if (found.length === 0) {
        void vscode.window.showErrorMessage(`Cooper: no ${ext} file found in this project.`);
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(
        found.map((u) => ({ label: path.basename(u.fsPath), description: vscode.workspace.asRelativePath(u), u })),
        { placeHolder: `Pick a ${ext} to ${purpose}` });
    return pick?.u.fsPath;
}

/** Edit the palette of an indexed PNG (the source `gfx4snes` consumes) — a BGR555
 *  editor that writes the PNG's PLTE back on Save. */
async function editPalette(uri?: vscode.Uri): Promise<void> {
    const file = await resolveProjectFile(uri, '.png', 'edit its SNES palette');
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
    const file = await resolveProjectFile(uri, '.png', 'edit its tiles/sprites');
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

/** View a `.map` (gfx4snes output) assembled with its `.pic` tileset + `.pal`,
 *  applying the real SNES per-cell attributes (sub-palette + H/V flip) — what
 *  Tiled doesn't show hardware-faithfully. Read-only. */
async function viewTilemap(uri?: vscode.Uri): Promise<void> {
    const mapPath = await resolveProjectFile(uri, '.map', 'view assembled');
    if (!mapPath) {
        return;
    }
    const base = mapPath.replace(/\.map$/, '');
    const picPath = `${base}.pic`, palPath = `${base}.pal`;
    if (!fs.existsSync(picPath) || !fs.existsSync(palPath)) {
        void vscode.window.showErrorMessage(`Cooper: need ${path.basename(picPath)} + ${path.basename(palPath)} beside the .map — Build first (gfx4snes -m -p).`);
        return;
    }
    try {
        const entries = parseTilemapEntries(fs.readFileSync(mapPath));
        const picBytes = Array.from(fs.readFileSync(picPath));
        const tiles = decodeTileSheet(picBytes, 4, Math.floor(picBytes.length / bytesPerTile(4)));
        const palBlob = fs.readFileSync(palPath);
        const palette = [];
        for (let i = 0; i + 1 < palBlob.length; i += 2) {
            palette.push(bgr555ToRgb8(palBlob.readUInt16LE(i)));
        }
        const width = 32; // a single 32×32 screen — the common gfx4snes -m output
        const img = assembleTilemapRgba(entries, tiles, palette, width);
        const png = encodePng(img.width, img.height, img.data).toString('base64');
        const panel = vscode.window.createWebviewPanel(
            'cooperTilemap', `Tilemap: ${path.basename(mapPath)}`, vscode.ViewColumn.Active, { enableScripts: false });
        const info = `${entries.length} entries · ${width}×${Math.ceil(entries.length / width)} tiles · ${img.width}×${img.height}px`;
        panel.webview.html = renderVramHtml(png, panel.webview.cspSource, info, Math.min(640, img.width * 2));
    } catch (e) {
        void vscode.window.showErrorMessage(`Cooper: tilemap view failed — ${(e as Error).message}`);
    }
}

// ---------------------------------------------------------------------------
// AI helper (C7) — part 1: ship OpenSNES context so any assistant is expert.
// ---------------------------------------------------------------------------

/** Write AGENTS.md (+ .github/copilot-instructions.md) with the OpenSNES/SNES
 *  hardware + SDK rules, so Copilot / Claude Code / Cursor become OpenSNES-aware. */
async function configureAI(): Promise<void> {
    const dir = (await resolveProjectDir()) ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!dir) {
        void vscode.window.showErrorMessage('Cooper: open an OpenSNES project first.');
        return;
    }
    const info = await resolveProjectInfo();
    const agents = path.join(dir, 'AGENTS.md');
    if (fs.existsSync(agents)) {
        const ans = await vscode.window.showWarningMessage(
            'AGENTS.md already exists. Overwrite it with the OpenSNES context?', 'Overwrite', 'Cancel');
        if (ans !== 'Overwrite') {
            return;
        }
    }
    let mcpNote = '';
    try {
        fs.writeFileSync(agents, renderAgentsMd({
            projectName: info.romName ? info.romName.replace(/\.(sfc|smc)$/i, '') : path.basename(dir),
            romName: info.romName ?? undefined,
        }));
        const gh = path.join(dir, '.github');
        fs.mkdirSync(gh, { recursive: true });
        const copilot = path.join(gh, 'copilot-instructions.md');
        if (!fs.existsSync(copilot)) {
            fs.writeFileSync(copilot, renderCopilotInstructions());
        }
        mcpNote = registerLunaMcp(dir);
    } catch (e) {
        void vscode.window.showErrorMessage(`Cooper: could not write the AI context — ${(e as Error).message}`);
        return;
    }
    void vscode.window.showInformationMessage(
        `Cooper: wrote AGENTS.md + copilot-instructions${mcpNote} — your AI knows OpenSNES${mcpNote ? ' and can drive luna' : ''}. Reload / start agent mode to pick up the MCP server.`,
        'Open AGENTS.md',
    ).then((a) => {
        if (a) {
            void vscode.window.showTextDocument(vscode.Uri.file(agents));
        }
    });
}

/** Register luna as an MCP server for whatever assistant the user has: writes
 *  `.vscode/mcp.json` (VS Code / Copilot, key `servers`) + `.mcp.json` (Claude
 *  Code / Cursor, key `mcpServers`), merging into any existing file. Returns a note
 *  for the summary, or '' if luna wasn't found. Skips a file it can't parse (so a
 *  hand-authored JSONC config is never clobbered). */
function registerLunaMcp(dir: string): string {
    const cfg = vscode.workspace.getConfiguration('cooper');
    const sdk = detectSdk({ configured: cfg.get<string>('opensnesPath')?.trim() || undefined, projectDir: dir });
    const luna = resolveLunaPath({ configured: cfg.get<string>('lunaPath')?.trim() || undefined, sdkPath: sdk?.path });
    if (!luna) {
        return '';
    }
    const write = (file: string, merge: (existing: string | null, cmd: string) => string): void => {
        try {
            const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
            fs.writeFileSync(file, merge(existing, luna));
        } catch { /* unparseable (JSONC/comments) — leave it, don't clobber */ }
    };
    const vscodeDir = path.join(dir, '.vscode');
    fs.mkdirSync(vscodeDir, { recursive: true });
    write(path.join(vscodeDir, 'mcp.json'), (e, c) => mergeVscodeMcp(e, c));
    write(path.join(dir, '.mcp.json'), (e, c) => mergeProjectMcp(e, c));
    return ' + luna MCP (.vscode/mcp.json, .mcp.json)';
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
    log(`make: ${debug ? 'debug (-g)' : 'release'} build in ${projectDir} (target ${target ?? 'all'})`);
    return new Promise<boolean>((resolve) => {
        const disp = vscode.tasks.onDidEndTaskProcess((e) => {
            if (e.execution.task === task) {
                disp.dispose();
                log(`make: exited ${e.exitCode ?? '?'}`);
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
    log(`make: release build in ${projectDir} (target ${target ?? 'all'})`);
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
    log(`preview: ${luna} ${args.join(' ')} (cwd ${projectDir})`);
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Cooper: rendering ${romName} in luna…` },
        async (): Promise<string | null> => {
            const t0 = Date.now();
            try {
                // timeout: a wedged luna must surface an error, never a stuck spinner
                await execFileAsync(luna, args, { cwd: projectDir, timeout: 30000 });
            } catch (err: unknown) {
                const e = err as { stderr?: string; killed?: boolean };
                fail(`luna preview failed${e.killed ? ' (timed out after 30s)' : ''}: ${e.stderr?.trim() || String(err)}`);
                return null;
            }
            log(`preview: rendered in ${Date.now() - t0}ms → ${png}`);
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
                    lastPreviewDataUri = `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`;
                    void panel.webview.postMessage({ type: 'preview', dataUri: lastPreviewDataUri });
                }
                break;
            }
            case 'refresh': {
                // Re-render the dashboard with fresh state (SDK/luna/ROM dots); the
                // new document posts 'ready' and gets the cached preview back.
                void vscode.commands.executeCommand('cooper.refresh');
                panel.webview.html = renderDashboardHtml(await dashboardState(), panel.webview.cspSource, nonce());
                break;
            }
            case 'ready': {
                if (lastPreviewDataUri) {
                    void panel.webview.postMessage({ type: 'preview', dataUri: lastPreviewDataUri });
                }
                break;
            }
        }
    });
    panel.webview.html = renderDashboardHtml(await dashboardState(), panel.webview.cspSource, nonce());
}

let lastPreviewDataUri: string | undefined;

// ---------------------------------------------------------------------------
// Palette viewer (P2.2c) — a webview of the live CGRAM at a debug stop.
// ---------------------------------------------------------------------------

interface PpuSnapshot { cgram: number[]; oam: number[]; vram: number[]; }

/**
 * Get a PPU snapshot for the viewers. If a luna debug session is paused, read the
 * **live** PPU at that stop. Otherwise run the built ROM to a frame in a
 * **transient luna** (like Preview) so the viewers work standalone from the
 * dashboard — no manual debug session needed.
 */
async function ppuSnapshot(needVram: boolean): Promise<PpuSnapshot | undefined> {
    const session = vscode.debug.activeDebugSession;
    if (session && session.type === 'luna') {
        try {
            const ppu = await session.customRequest('cooperPpu') as { cgram?: number[]; oam?: number[] };
            const vram = needVram
                ? ((await session.customRequest('cooperVram', { offset: 0, count: 0x4000 })) as { bytes?: number[] }).bytes ?? []
                : [];
            return { cgram: ppu.cgram ?? [], oam: ppu.oam ?? [], vram };
        } catch (e) {
            fail(`could not read the PPU state: ${String(e)}`);
            return undefined;
        }
    }

    const info = await resolveProjectInfo();
    const rom = info.projectDir && info.romName ? path.join(info.projectDir, info.romName) : undefined;
    if (!rom || !fs.existsSync(rom)) {
        fail('build the ROM first (or start a Debug session) to view the PPU.');
        return undefined;
    }
    const cfg = vscode.workspace.getConfiguration('cooper');
    const sdk = info.projectDir ? detectSdk({ configured: cfg.get<string>('opensnesPath')?.trim() || undefined, projectDir: info.projectDir }) : null;
    const luna = resolveLunaPath({ configured: cfg.get<string>('lunaPath')?.trim() || undefined, sdkPath: sdk?.path });
    if (!luna) {
        fail('set cooper.lunaPath to view the PPU.');
        return undefined;
    }
    const steps = Math.min(cfg.get<number>('preview.steps') ?? 200000, 500000);
    log(`ppu viewer: no debug session — transient luna run (${rom}, ${steps} steps)`);
    return vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Cooper: reading the PPU from luna…', cancellable: false },
        async () => {
            const t0 = Date.now();
            const mcp = new LunaMcp({ onLog: log });
            try {
                // Hard overall timeout so a stuck luna handshake can never hang the
                // viewer silently (the old behaviour the user hit).
                const snap = await withTimeout((async () => {
                    await mcp.connect(luna, info.projectDir ?? undefined);
                    await mcp.loadRom(rom);
                    await mcp.step(steps);
                    const s = await mcp.state() as { ppu?: { cgram?: number[]; oam_full?: number[] } };
                    const ppu = s.ppu ?? {};
                    const vram = needVram ? await mcp.peekVram(0, 0x4000) : [];
                    return { cgram: ppu.cgram ?? [], oam: ppu.oam_full ?? [], vram };
                })(), 25000, `luna at ${luna}`);
                log(`ppu viewer: snapshot read in ${Date.now() - t0}ms`);
                return snap;
            } catch (e) {
                fail(`could not read the PPU from luna — ${(e as Error).message}`);
                return undefined;
            } finally {
                mcp.dispose();
            }
        },
    );
}

/** Reject after `ms` if `p` hasn't settled — a guard so a wedged child process
 *  surfaces an error instead of hanging a progress spinner forever. */
function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s waiting for ${what}`)), ms);
        p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
    });
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
    const ppu = await ppuSnapshot(false);
    if (!ppu) {
        return;
    }
    const colors = decodeCgram(ppu.cgram);
    showViewer('cooperPalette', 'CGRAM Palette', (w) => renderPaletteHtml(colors, w.cspSource));
}

async function showOam(): Promise<void> {
    const ppu = await ppuSnapshot(false);
    if (!ppu) {
        return;
    }
    const sprites = decodeOam(ppu.oam);
    showViewer('cooperOam', 'OAM (sprites)', (w) => renderOamHtml(sprites, w.cspSource));
}

async function showVram(): Promise<void> {
    const ppu = await ppuSnapshot(true);
    if (!ppu) {
        return;
    }
    const BPP = 4, TILES_PER_ROW = 16;
    const count = Math.floor(ppu.vram.length / bytesPerTile(BPP));
    const tiles = decodeTileSheet(ppu.vram, BPP, count);
    const palette = decodeCgram(ppu.cgram).slice(0, 16); // sub-palette 0
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
        return new vscode.DebugAdapterInlineImplementation(new LunaDebugSession(log));
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
