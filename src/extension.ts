import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { detectSdk, renderClangd, isOpenSnesRoot, SdkSource, findProjectDir } from './clangdConfig';
import { resolveLunaPath, resolveLunaGuiPath, lunaPreviewArgs, buildMakeArgs, romTargetFromMakefile, isWatchSource } from './build';
import { LunaDebugSession } from './lunaDebug';
import { LunaMcp, DisasmLine } from './lunaMcp';
import { renderDisasmHtml } from './disasmView';
import { renderMemTraceHtml, TracedEvent } from './memTraceView';
import { wramMap, renderMemoryMapHtml } from './memoryMap';
import { releaseArchTag, sdkSupportsDebugInfo, OPENSNES_RELEASES_URL, LUNA_RELEASES_URL } from './onboarding';
import { listExamples, scaffoldProject, validateProjectName } from './newProject';
import { renderVramViewHtml, VramViewOpts, DEFAULT_VRAM_OPTS, VRAM_WINDOW } from './vramView';
import { decodeCgram, renderPaletteHtml, decodeOam, renderOamHtml } from './ppu';
import { decodeTileSheet, tilesToRgba, encodePng, renderVramHtml, bytesPerTile } from './tiles';
import { readIndexedPng, readIndexedPixels, writePalette, writeIndexedPixels, bgr555ToRgb8 } from './pngPalette';
import { renderPaletteEditorHtml } from './paletteEditor';
import { renderTileEditorHtml } from './tileEditor';
import { parseTilemapEntries, assembleTilemapRgba } from './tilemap';
import { renderAgentsMd, renderCopilotInstructions } from './aiContext';
import { mergeVscodeMcp, mergeProjectMcp } from './mcpConfig';
import { parseSym } from './sym';
import { buildTreeModel, userFunctions, functionDefLines, TreeNode, ProjectInfo } from './sidebar';
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

/** A missing-tool error with a way OUT: a download button for this machine's
 *  prebuilt release (arch-aware) + a jump to the setting. */
function failWithDownload(kind: 'sdk' | 'luna', msg: string): void {
    log(`ERROR: ${msg}`);
    const tag = releaseArchTag(process.platform, process.arch);
    const dl = tag ? `Download (${tag.replace('_', ' ')})` : 'Open releases';
    const setting = kind === 'sdk' ? 'cooper.opensnesPath' : 'cooper.lunaPath';
    void vscode.window.showErrorMessage(`Cooper: ${msg}`, dl, 'Open Settings').then((pick) => {
        if (pick === dl) {
            void vscode.env.openExternal(vscode.Uri.parse(kind === 'sdk' ? OPENSNES_RELEASES_URL : LUNA_RELEASES_URL));
        } else if (pick === 'Open Settings') {
            void vscode.commands.executeCommand('workbench.action.openSettings', setting);
        }
    });
}

export function activate(context: vscode.ExtensionContext): void {
    output = vscode.window.createOutputChannel('Cooper');
    log(`Cooper activated (v${(context.extension.packageJSON as { version?: string }).version ?? '?'})`);
    const tree = new CooperTreeProvider();
    const codeLens = new CooperCodeLensProvider();
    context.subscriptions.push(
        output,
        vscode.commands.registerCommand('cooper.showLog', () => output?.show(true)),
        vscode.commands.registerCommand('cooper.configureClangd', () => configureClangd()),
        vscode.commands.registerCommand('cooper.build', () => runBuild()),
        vscode.commands.registerCommand('cooper.preview', () => previewFrame(context)),
        vscode.commands.registerCommand('cooper.play', () => playInLunaGui()),
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
        vscode.commands.registerCommand('cooper.saveSnapshot', () => saveSnapshot(context)),
        vscode.commands.registerCommand('cooper.restoreSnapshot', () => restoreSnapshot(context)),
        vscode.commands.registerCommand('cooper.showDisasm', () => showDisasm()),
        vscode.commands.registerCommand('cooper.traceMemory', () => traceMemory()),
        vscode.commands.registerCommand('cooper.newProject', () => newProject()),
        vscode.commands.registerCommand('cooper.debugHere', (name: string) => debugHere(name)),
        vscode.commands.registerCommand('cooper.watch', () => toggleWatch(context)),
        vscode.commands.registerCommand('cooper.showMemoryMap', () => showMemoryMap()),
        { dispose: () => { watchState?.watcher.dispose(); watchState?.status.dispose(); } },
        vscode.window.registerTreeDataProvider('cooperTree', tree),
        vscode.languages.registerCodeLensProvider({ language: 'c' }, codeLens),
        vscode.debug.onDidChangeBreakpoints(() => codeLens.refresh()),
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
        failWithDownload('sdk', 'the OpenSNES SDK could not be located — download the prebuilt release for your machine and point cooper.opensnesPath at it.');
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
        failWithDownload('luna', 'could not find the luna binary — download the prebuilt release for your machine and point cooper.lunaPath at it.');
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
// Play (G1) — launch the game in luna-gui, a real native window (D-051).
// ---------------------------------------------------------------------------

async function playInLunaGui(): Promise<void> {
    const projectDir = await resolveProjectDir();
    if (!projectDir) {
        fail('no OpenSNES project (a folder with a Makefile) found.');
        return;
    }
    const mk = path.join(projectDir, 'Makefile');
    const romName = fs.existsSync(mk) ? romTargetFromMakefile(fs.readFileSync(mk, 'utf8')) : null;
    if (!romName) {
        fail('no TARGET in the Makefile — cannot locate the ROM.');
        return;
    }
    const romPath = path.join(projectDir, romName);
    if (!fs.existsSync(romPath)) {
        const pick = await vscode.window.showWarningMessage(`Cooper: ${romName} not built yet. Build it first?`, 'Build');
        if (pick === 'Build') {
            await runBuild();
        }
        return;
    }
    const cfg = vscode.workspace.getConfiguration('cooper');
    const opts = {
        configured: cfg.get<string>('lunaPath')?.trim() || undefined,
        sdkPath: detectSdk({ configured: cfg.get<string>('opensnesPath')?.trim() || undefined, projectDir })?.path,
    };
    const gui = resolveLunaGuiPath(opts);
    if (!gui) {
        failWithDownload('luna', 'luna-gui not found — it ships in the luna release zip, next to the luna binary (point cooper.lunaPath at that folder).');
        return;
    }
    // A game session, not a tool call: spawn detached so it lives (and keeps
    // playing) independently of VS Code; stdio ignored, errors via 'error'.
    log(`play: ${gui} ${romPath}`);
    const child = spawn(gui, [romPath], { cwd: projectDir, detached: true, stdio: 'ignore' });
    child.on('error', (e) => fail(`could not launch luna-gui: ${e.message}`));
    child.unref();
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
            case 'new': await newProject(); break;
            case 'play': await playInLunaGui(); break;
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
// Disassembly viewer — luna disasm_cpu at the current stop (symbol-annotated).
// ---------------------------------------------------------------------------

async function showDisasm(): Promise<void> {
    const session = activeLunaSession();
    if (!session) {
        return;
    }
    try {
        const r = await session.customRequest('cooperDisasm', { lines: 64 }) as { lines: DisasmLine[] };
        showViewer('cooperDisasm', 'Disassembly', (w) => renderDisasmHtml(r.lines, w.cspSource));
    } catch (e) {
        fail(`could not disassemble: ${String(e)}`);
    }
}

// ---------------------------------------------------------------------------
// Memory map (G4) — "where did my memory go?": WRAM ramsections from the .sym
// + a VRAM occupancy heatmap from the live/transient snapshot.
// ---------------------------------------------------------------------------

async function showMemoryMap(): Promise<void> {
    const info = await resolveProjectInfo();
    const symPath = info.projectDir && info.romName
        ? path.join(info.projectDir, info.romName.replace(/\.(sfc|smc)$/i, '') + '.sym')
        : null;
    if (!symPath || !fs.existsSync(symPath)) {
        fail('no .sym found — build the project first (the memory map reads the linker\'s ramsections).');
        return;
    }
    let sym;
    try {
        sym = parseSym(fs.readFileSync(symPath, 'utf8'));
    } catch (e) {
        fail(`could not parse ${path.basename(symPath)}: ${String(e)}`);
        return;
    }
    const ppu = await ppuSnapshot(true); // live at a stop, else transient luna
    const vram = ppu?.vram ?? [];
    const map = wramMap(sym);
    log(`memory map: ${map.blocks.length} WRAM blocks (${map.totalReserved} bytes), vram snapshot ${vram.length ? 'yes' : 'NO'}`);
    showViewer('cooperMemoryMap', 'Memory Map', (w) => renderMemoryMapHtml(map, vram, w.cspSource));
}

// ---------------------------------------------------------------------------
// Watch mode (G3) — save a source → quiet incremental rebuild → refreshed
// preview. Single-flight with a trailing rebuild; generated artifacts filtered
// (isWatchSource) so `make`'s own outputs can't re-trigger the loop.
// ---------------------------------------------------------------------------

let watchState: {
    watcher: vscode.FileSystemWatcher;
    status: vscode.StatusBarItem;
    timer?: ReturnType<typeof setTimeout>;
    building: boolean;
    dirty: boolean;
} | undefined;

async function toggleWatch(context: vscode.ExtensionContext): Promise<void> {
    if (watchState) {
        watchState.watcher.dispose();
        watchState.status.dispose();
        clearTimeout(watchState.timer);
        watchState = undefined;
        log('watch: OFF');
        return;
    }
    const projectDir = await resolveProjectDir();
    if (!projectDir) {
        fail('no OpenSNES project to watch (open a folder with a Makefile).');
        return;
    }
    const sdk = sdkPathFor(projectDir);
    if (!sdk) {
        failWithDownload('sdk', 'the SDK is needed to rebuild on save — set cooper.opensnesPath.');
        return;
    }
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(projectDir, '**/*'));
    const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    status.text = '$(eye) Cooper watch';
    status.tooltip = 'Watch mode: rebuild + preview on save (click to stop)';
    status.command = 'cooper.watch';
    status.show();
    watchState = { watcher, status, building: false, dirty: false };
    log(`watch: ON (${projectDir})`);

    const rebuild = async (): Promise<void> => {
        if (!watchState) {
            return;
        }
        if (watchState.building) {
            watchState.dirty = true; // trailing rebuild after the current one
            return;
        }
        watchState.building = true;
        watchState.status.text = '$(sync~spin) Cooper build…';
        const t0 = Date.now();
        try {
            await execFileAsync('make', [`OPENSNES=${sdk}`], { cwd: projectDir, timeout: 120000 });
            log(`watch: rebuilt in ${Date.now() - t0}ms`);
            watchState.status.text = '$(eye) Cooper watch';
            const png = await generatePreviewPngQuiet(context, projectDir, sdk);
            if (png && homePanel) {
                lastPreviewDataUri = `data:image/png;base64,${fs.readFileSync(png).toString('base64')}`;
                void homePanel.webview.postMessage({ type: 'preview', dataUri: lastPreviewDataUri });
            }
        } catch (e) {
            watchState.status.text = '$(error) Cooper build failed';
            const err = (e as { stderr?: string; stdout?: string });
            log(`watch: build FAILED — ${(err.stderr || err.stdout || String(e)).split('\n').slice(-6).join('\n')}`);
        } finally {
            if (watchState) {
                watchState.building = false;
                if (watchState.dirty) {
                    watchState.dirty = false;
                    void rebuild();
                }
            }
        }
    };
    const onChange = (uri: vscode.Uri): void => {
        if (!watchState || !isWatchSource(uri.fsPath)) {
            return;
        }
        clearTimeout(watchState.timer);
        watchState.timer = setTimeout(() => void rebuild(), 300);
    };
    watcher.onDidChange(onChange);
    watcher.onDidCreate(onChange);
    watcher.onDidDelete(onChange);
    void rebuild(); // prime: build now so the first save's change is visible alone
}

/** Preview render without toasts/progress — the watch loop's quiet variant. */
async function generatePreviewPngQuiet(context: vscode.ExtensionContext, projectDir: string, sdk: string): Promise<string | null> {
    const mk = path.join(projectDir, 'Makefile');
    const romName = fs.existsSync(mk) ? romTargetFromMakefile(fs.readFileSync(mk, 'utf8')) : null;
    const romPath = romName ? path.join(projectDir, romName) : null;
    const luna = resolveLunaPath({
        configured: vscode.workspace.getConfiguration('cooper').get<string>('lunaPath')?.trim() || undefined,
        sdkPath: sdk,
    });
    if (!romPath || !fs.existsSync(romPath) || !luna) {
        return null;
    }
    const storageDir = context.globalStorageUri.fsPath;
    fs.mkdirSync(storageDir, { recursive: true });
    const png = path.join(storageDir, 'preview.png');
    const cfg = vscode.workspace.getConfiguration('cooper');
    const args = lunaPreviewArgs(romPath, png, {
        steps: cfg.get<number>('preview.steps'),
        forceDisplay: cfg.get<boolean>('preview.forceDisplay'),
    });
    try {
        await execFileAsync(luna, args, { cwd: projectDir, timeout: 30000 });
    } catch (e) {
        log(`watch: preview failed — ${String((e as { stderr?: string }).stderr ?? e)}`);
        return null;
    }
    return fs.existsSync(png) ? png : null;
}

// ---------------------------------------------------------------------------
// CodeLens (G2b) — "◉ break · ▶ debug here" above the project's C functions
// (the ones that actually made it into the ROM: .c ∩ .sym, like the sidebar).
// ---------------------------------------------------------------------------

class CooperCodeLensProvider implements vscode.CodeLensProvider {
    private emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses = this.emitter.event;

    refresh(): void {
        this.emitter.fire();
    }

    async provideCodeLenses(doc: vscode.TextDocument): Promise<vscode.CodeLens[]> {
        if (!vscode.workspace.getConfiguration('cooper').get<boolean>('codeLens', true)) {
            return [];
        }
        const info = await resolveProjectInfo();
        if (!info.projectDir || !info.functions.length
            || !doc.uri.fsPath.startsWith(info.projectDir + path.sep)) {
            return [];
        }
        const names = new Set(info.functions.map((f) => f.name));
        return functionDefLines(doc.getText(), names).flatMap(({ name, line }) => {
            const range = new vscode.Range(line, 0, line, 0);
            const has = vscode.debug.breakpoints.some(
                (b) => b instanceof vscode.FunctionBreakpoint && b.functionName === name,
            );
            return [
                new vscode.CodeLens(range, {
                    title: has ? '◉ breakpoint set' : '◉ break',
                    tooltip: `Toggle a breakpoint on ${name}()`,
                    command: 'cooper.breakOnSymbol',
                    arguments: [name],
                }),
                new vscode.CodeLens(range, {
                    title: '▶ debug here',
                    tooltip: `Break on ${name}() and start debugging`,
                    command: 'cooper.debugHere',
                    arguments: [name],
                }),
            ];
        });
    }
}

/** Ensure a function breakpoint on `name`, then launch the debugger. */
async function debugHere(name: string): Promise<void> {
    const has = vscode.debug.breakpoints.some(
        (b) => b instanceof vscode.FunctionBreakpoint && b.functionName === name,
    );
    if (!has) {
        vscode.debug.addBreakpoints([new vscode.FunctionBreakpoint(name)]);
    }
    await vscode.commands.executeCommand('cooper.debug');
}

// ---------------------------------------------------------------------------
// New Project — copy an SDK example out-of-tree, rewrite its Makefile, build,
// open. Cooper embeds no templates: the SDK's examples ARE the starters (D-050).
// ---------------------------------------------------------------------------

async function newProject(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('cooper');
    const sdk = detectSdk({
        configured: cfg.get<string>('opensnesPath')?.trim() || undefined,
        projectDir: vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '',
    });
    if (!sdk) {
        failWithDownload('sdk', 'the OpenSNES SDK is needed to create a project — download it, set cooper.opensnesPath, then retry.');
        return;
    }
    const examples = listExamples(sdk.path);
    if (!examples.length) {
        fail(`no examples found under ${sdk.path}/examples — is cooper.opensnesPath a full SDK?`);
        return;
    }
    const MINIMAL = 'text/hello_world';
    const picked = await vscode.window.showQuickPick(
        examples.map((e) => ({
            label: e.id === MINIMAL ? `$(star) ${e.id}` : e.id,
            description: e.id === MINIMAL ? 'minimal starter (recommended)' : undefined,
            id: e.id, dir: e.dir,
        })).sort((a, b) => (a.id === MINIMAL ? -1 : b.id === MINIMAL ? 1 : 0)),
        { placeHolder: 'Start from which SDK example?', matchOnDescription: true },
    );
    if (!picked) {
        return;
    }
    const name = await vscode.window.showInputBox({
        prompt: 'Project name (folder + ROM name)',
        value: path.basename(picked.id).replace(/_/g, '-'),
        validateInput: validateProjectName,
    });
    if (!name) {
        return;
    }
    const parent = await vscode.window.showOpenDialog({
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
        openLabel: 'Create the project here',
        title: `The "${name}" folder will be created inside…`,
    });
    if (!parent?.[0]) {
        return;
    }
    const dest = path.join(parent[0].fsPath, name);
    if (fs.existsSync(dest)) {
        fail(`${dest} already exists — pick another name or folder.`);
        return;
    }

    try {
        const copied = scaffoldProject(picked.dir, dest, name, sdk.path);
        fs.writeFileSync(path.join(dest, '.clangd'), renderClangd(sdk.path));
        log(`new project: ${picked.id} → ${dest} (${copied} files, SDK ${sdk.path})`);
    } catch (e) {
        fail(`could not create the project: ${(e as Error).message}`);
        return;
    }

    // First build, before opening — so the new window starts with a ROM ready
    // to Run/Debug (opening the folder restarts the extension host).
    const built = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Cooper: first build of ${name}…` },
        async () => {
            try {
                await execFileAsync('make', [`OPENSNES=${sdk.path}`], { cwd: dest, timeout: 120000 });
                return true;
            } catch (e) {
                log(`new project: first build failed — ${String((e as { stderr?: string }).stderr ?? e)}`);
                return false;
            }
        },
    );
    const pick = await vscode.window.showInformationMessage(
        built
            ? `Cooper: "${name}" created and built — open it and press Run.`
            : `Cooper: "${name}" created (the first build failed — open it and see the Build output).`,
        'Open Project', 'Open in New Window',
    );
    if (pick) {
        await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(dest), pick === 'Open in New Window');
    }
}

// ---------------------------------------------------------------------------
// Memory trace — "who accesses this address?" over one frame (luna mem trace).
// ---------------------------------------------------------------------------

async function traceMemory(): Promise<void> {
    const session = activeLunaSession();
    if (!session) {
        return;
    }
    const expr = await vscode.window.showInputBox({
        prompt: 'Which address? A symbol (frame_count) or an address ($7E0030) — the watch is bank-exact.',
        placeHolder: 'frame_count · $7E0030',
    });
    if (!expr) {
        return;
    }
    try {
        const r = await session.customRequest('cooperMemTrace', { expr }) as { addr: number; events: TracedEvent[] };
        log(`mem trace: ${expr} → ${r.events.length} event(s) over one frame`);
        showViewer('cooperMemTrace', `Trace ${expr}`, (w) => renderMemTraceHtml(expr, r.addr, r.events, w.cspSource));
    } catch (e) {
        fail(`memory trace failed: ${String(e)}`);
    }
}

// ---------------------------------------------------------------------------
// Debug snapshots — luna save/load_state at a debug stop (D-046). Blobs are
// ROM-hash-guarded by luna, stored under globalStorage/snapshots/.
// ---------------------------------------------------------------------------

/** The paused luna debug session, or undefined (with a toast). */
function activeLunaSession(): vscode.DebugSession | undefined {
    const s = vscode.debug.activeDebugSession;
    if (!s || s.type !== 'luna') {
        fail('start a Luna debug session first (snapshots capture the paused machine).');
        return undefined;
    }
    return s;
}

function snapshotsDir(context: vscode.ExtensionContext): string {
    const dir = path.join(context.globalStorageUri.fsPath, 'snapshots');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

async function saveSnapshot(context: vscode.ExtensionContext): Promise<void> {
    const session = activeLunaSession();
    if (!session) {
        return;
    }
    const name = await vscode.window.showInputBox({
        prompt: 'Snapshot name',
        value: `snapshot-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}`,
        validateInput: (v) => (/^[\w.-]+$/.test(v) ? undefined : 'letters, digits, . _ - only'),
    });
    if (!name) {
        return;
    }
    try {
        const r = await session.customRequest('cooperSaveState') as { stateBase64: string; bytes: number };
        const file = path.join(snapshotsDir(context), `${name}.lunastate`);
        fs.writeFileSync(file, r.stateBase64, 'utf8');
        log(`snapshot: saved ${name} (${r.bytes} bytes) → ${file}`);
        void vscode.window.showInformationMessage(`Cooper: snapshot "${name}" saved (${Math.round(r.bytes / 1024)} KB).`);
    } catch (e) {
        fail(`could not save the snapshot: ${String(e)}`);
    }
}

async function restoreSnapshot(context: vscode.ExtensionContext): Promise<void> {
    const session = activeLunaSession();
    if (!session) {
        return;
    }
    const dir = snapshotsDir(context);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.lunastate')).sort().reverse();
    if (!files.length) {
        fail('no snapshots yet — use "Cooper: Save Debug Snapshot" at a stop first.');
        return;
    }
    const picked = await vscode.window.showQuickPick(files.map((f) => f.replace(/\.lunastate$/, '')), {
        placeHolder: 'Restore which snapshot? (a snapshot only loads against its own ROM)',
    });
    if (!picked) {
        return;
    }
    try {
        const stateBase64 = fs.readFileSync(path.join(dir, `${picked}.lunastate`), 'utf8');
        await session.customRequest('cooperLoadState', { stateBase64 });
        log(`snapshot: restored ${picked}`);
        void vscode.window.showInformationMessage(`Cooper: snapshot "${picked}" restored.`);
    } catch (e) {
        fail(`could not restore "${picked}": ${String(e)} (snapshots only load against the same ROM build)`);
    }
}

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
            // full 64 KB VRAM in two reads (peek_vram's count is u16, max 0xFFFF)
            const vram = needVram
                ? [
                    ...(((await session.customRequest('cooperVram', { offset: 0, count: 0x8000 })) as { bytes?: number[] }).bytes ?? []),
                    ...(((await session.customRequest('cooperVram', { offset: 0x8000, count: 0x8000 })) as { bytes?: number[] }).bytes ?? []),
                ]
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
        failWithDownload('luna', 'could not find the luna binary (needed to view the PPU) — download it and set cooper.lunaPath.');
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
                    const vram = needVram
                        ? [...await mcp.peekVram(0, 0x8000), ...await mcp.peekVram(0x8000, 0x8000)]
                        : [];
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

// The VRAM viewer is interactive (bpp/offset/sub-palette selectors, G2): it
// keeps the last full VRAM+CGRAM snapshot and re-renders it locally on every
// control change — luna is only consulted on open and on "Re-read VRAM".
let vramPanel: vscode.WebviewPanel | undefined;
let vramSnapshot: { vram: number[]; cgram: number[] } | undefined;
let vramOpts: VramViewOpts = { ...DEFAULT_VRAM_OPTS };

function renderVramPanel(): void {
    if (vramPanel && vramSnapshot) {
        vramPanel.webview.html = renderVramViewHtml(vramSnapshot.vram, vramSnapshot.cgram, vramOpts, vramPanel.webview.cspSource, nonce());
    }
}

async function showVram(): Promise<void> {
    const ppu = await ppuSnapshot(true);
    if (!ppu) {
        return;
    }
    vramSnapshot = { vram: ppu.vram, cgram: ppu.cgram };
    if (vramPanel) {
        vramPanel.reveal(undefined, true);
    } else {
        vramPanel = vscode.window.createWebviewPanel('cooperVram', 'Tiles (VRAM)', vscode.ViewColumn.Beside,
            { enableScripts: true, retainContextWhenHidden: true });
        vramPanel.onDidDispose(() => { vramPanel = undefined; vramSnapshot = undefined; });
        vramPanel.webview.onDidReceiveMessage(async (m: { command?: string; bpp?: number; offset?: number; subpal?: number }) => {
            if (m.command === 'vramOpts') {
                vramOpts = {
                    bpp: (m.bpp === 2 || m.bpp === 8 ? m.bpp : 4),
                    offset: Math.max(0, Math.min(0x10000 - VRAM_WINDOW, m.offset ?? 0)),
                    subpal: m.subpal ?? 0,
                };
                renderVramPanel();
            } else if (m.command === 'vramRefresh') {
                const fresh = await ppuSnapshot(true);
                if (fresh) {
                    vramSnapshot = { vram: fresh.vram, cgram: fresh.cgram };
                    renderVramPanel();
                }
            }
        });
    }
    renderVramPanel();
}

// ---------------------------------------------------------------------------
// Debugger (P2.1b) — inline DAP adapter over luna MCP + the WLA .sym.
// ---------------------------------------------------------------------------

let warnedNoDebugInfo = false;

/** Warn (once per session) when the SDK's cc65816 predates the Cooper debug
 *  info (< 0.26, no CC65816_G gate): the debugger still works, but at the
 *  symbol level — no main.c lines, no typed locals. */
function warnIfNoDebugInfo(sdkPath: string): void {
    if (warnedNoDebugInfo) {
        return;
    }
    for (const rel of [['bin', 'cc65816'], ['compiler', 'scripts', 'cc65816']]) {
        const p = path.join(sdkPath, ...rel);
        try {
            if (fs.existsSync(p)) {
                if (!sdkSupportsDebugInfo(fs.readFileSync(p, 'utf8'))) {
                    warnedNoDebugInfo = true;
                    log(`debug: ${p} has no CC65816_G gate — SDK < 0.26, source-level C debug unavailable`);
                    void vscode.window.showWarningMessage(
                        'Cooper: your OpenSNES release predates the Cooper debug info (< 0.26). Debugging works at the symbol level only — update the SDK for main.c breakpoints and typed locals.',
                        'Open releases',
                    ).then((pick) => {
                        if (pick === 'Open releases') {
                            void vscode.env.openExternal(vscode.Uri.parse(OPENSNES_RELEASES_URL));
                        }
                    });
                }
                return;
            }
        } catch { /* unreadable wrapper: skip the check */ }
    }
}

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
            failWithDownload('sdk', `${path.basename(romPath)} isn't built, and the SDK couldn't be located to build it.`);
            return undefined;
        }

        if (sdk?.path) {
            warnIfNoDebugInfo(sdk.path);
        }

        const luna = resolveLunaPath({ configured: cfg.get<string>('lunaPath')?.trim() || undefined, sdkPath: sdk?.path });
        if (!luna) {
            failWithDownload('luna', 'could not find the luna binary — download the prebuilt release and set cooper.lunaPath.');
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
