import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { detectSdk, renderClangd, isOpenSnesRoot, SdkSource, renderCompileCommands } from './clangdConfig';
import { findRomForDir, resolveLunaPath, lunaPreviewArgs, makeArgs } from './build';
import { LunaDebugSession } from './lunaDebug';
import { decodeCgram, renderPaletteHtml, decodeOam, renderOamHtml } from './ppu';
import { decodeTileSheet, tilesToRgba, encodePng, renderVramHtml, bytesPerTile } from './tiles';

const execFileAsync = promisify(execFile);

const MAKE_TASK_TYPE = 'cooper-make';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('cooper.configureClangd', () => configureClangd()),
        vscode.commands.registerCommand('cooper.generateCompileCommands', () => generateCompileCommands()),
        vscode.commands.registerCommand('cooper.build', () => runBuild()),
        vscode.commands.registerCommand('cooper.preview', () => previewFrame(context)),
        vscode.commands.registerCommand('cooper.showPalette', () => showPalette()),
        vscode.commands.registerCommand('cooper.showOam', () => showOam()),
        vscode.commands.registerCommand('cooper.showVram', () => showVram()),
        vscode.tasks.registerTaskProvider(MAKE_TASK_TYPE, makeTaskProvider()),
        vscode.debug.registerDebugAdapterDescriptorFactory('luna', new LunaDebugAdapterFactory()),
        vscode.debug.registerDebugConfigurationProvider('luna', new LunaConfigProvider()),
    );
}

export function deactivate(): void {
    // nothing to clean up
}

// ---------------------------------------------------------------------------
// Build — a `make` task provider + a command that runs the build task.
// ---------------------------------------------------------------------------

function makeTask(target: string | undefined, scope: vscode.WorkspaceFolder | vscode.TaskScope): vscode.Task {
    const name = target && target !== 'all' ? target : 'build';
    const task = new vscode.Task(
        { type: MAKE_TASK_TYPE, target },
        scope,
        name,
        'cooper',
        new vscode.ShellExecution('make', makeArgs(target)),
        '$cooper-cc',
    );
    if (name === 'build') {
        task.group = vscode.TaskGroup.Build;
    } else if (name === 'clean') {
        task.group = vscode.TaskGroup.Clean;
    }
    return task;
}

function makeTaskProvider(): vscode.TaskProvider {
    return {
        provideTasks: () => {
            const tasks: vscode.Task[] = [];
            for (const folder of vscode.workspace.workspaceFolders ?? []) {
                if (fs.existsSync(path.join(folder.uri.fsPath, 'Makefile'))) {
                    tasks.push(makeTask(undefined, folder), makeTask('clean', folder));
                }
            }
            return tasks;
        },
        resolveTask: (task) => {
            const scope = typeof task.scope === 'object' ? task.scope : vscode.TaskScope.Workspace;
            return makeTask(task.definition.target as string | undefined, scope);
        },
    };
}

async function runBuild(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        void vscode.window.showErrorMessage('Cooper: open a project folder first.');
        return;
    }
    if (!fs.existsSync(path.join(folder.uri.fsPath, 'Makefile'))) {
        void vscode.window.showErrorMessage('Cooper: no Makefile in the workspace root to build.');
        return;
    }
    await vscode.tasks.executeTask(makeTask(undefined, folder));
}

// ---------------------------------------------------------------------------
// Preview — render a headless luna screenshot of the built ROM and open it.
// ---------------------------------------------------------------------------

async function previewFrame(context: vscode.ExtensionContext): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        void vscode.window.showErrorMessage('Cooper: open a project folder first.');
        return;
    }
    const projectDir = folder.uri.fsPath;

    // Resolve the ROM from the active file's dir (handles examples in subfolders),
    // falling back to the workspace root.
    const activeDir = vscode.window.activeTextEditor
        ? path.dirname(vscode.window.activeTextEditor.document.uri.fsPath)
        : projectDir;
    const target = findRomForDir(activeDir) ?? findRomForDir(projectDir);
    if (!target) {
        void vscode.window.showErrorMessage('Cooper: no Makefile with a TARGET found — cannot locate the ROM to preview.');
        return;
    }
    if (!fs.existsSync(target.rom)) {
        const pick = await vscode.window.showWarningMessage(
            `Cooper: ${path.basename(target.rom)} not built yet. Build it first?`,
            'Build (make)',
        );
        if (pick === 'Build (make)') {
            await runBuild();
        }
        return;
    }

    // Resolve the luna binary (setting → SDK pinned binary).
    const cfg = vscode.workspace.getConfiguration('cooper');
    const sdk = detectSdk({ configured: cfg.get<string>('opensnesPath')?.trim() || undefined, projectDir });
    const luna = resolveLunaPath({ configured: cfg.get<string>('lunaPath')?.trim() || undefined, sdkPath: sdk?.path });
    if (!luna) {
        void vscode.window.showErrorMessage('Cooper: could not find the luna binary. Set cooper.lunaPath, or cooper.opensnesPath so Cooper can use the SDK\'s pinned binary.');
        return;
    }

    // Screenshot lands in the extension's storage dir (not the user's source tree).
    const storageDir = context.globalStorageUri.fsPath;
    try {
        fs.mkdirSync(storageDir, { recursive: true });
    } catch { /* best-effort; the write below surfaces a real failure */ }
    const png = path.join(storageDir, 'preview.png');

    const args = lunaPreviewArgs(target.rom, png, {
        steps: cfg.get<number>('preview.steps'),
        forceDisplay: cfg.get<boolean>('preview.forceDisplay'),
    });

    await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Cooper: rendering ${path.basename(target.rom)} in luna…` },
        async () => {
            try {
                await execFileAsync(luna, args, { cwd: target.dir });
            } catch (err: unknown) {
                const stderr = (err as { stderr?: string }).stderr;
                void vscode.window.showErrorMessage(`Cooper: luna preview failed: ${stderr?.trim() || String(err)}`);
                return;
            }
            if (!fs.existsSync(png)) {
                void vscode.window.showErrorMessage('Cooper: luna ran but produced no screenshot.');
                return;
            }
            await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(png), vscode.ViewColumn.Beside);
        },
    );
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
    resolveDebugConfiguration(
        folder: vscode.WorkspaceFolder | undefined,
        config: vscode.DebugConfiguration,
    ): vscode.ProviderResult<vscode.DebugConfiguration> {
        const projectDir = folder?.uri.fsPath
            ?? (vscode.window.activeTextEditor && path.dirname(vscode.window.activeTextEditor.document.uri.fsPath));
        if (!projectDir) {
            void vscode.window.showErrorMessage('Cooper: open a project folder to debug.');
            return undefined;
        }

        // A bare "F5 with no launch.json": seed a launch config from the project.
        if (!config.type && !config.request && !config.name) {
            config.type = 'luna';
            config.request = 'launch';
            config.name = 'Luna: Debug SNES ROM';
        }

        // Default the ROM to the project's build output if not given.
        if (!config.program) {
            const found = findRomForDir(projectDir);
            if (found) {
                config.program = found.rom;
            }
        }
        if (!config.program) {
            void vscode.window.showErrorMessage('Cooper: no ROM to debug — set "program" in launch.json or add a Makefile with a TARGET.');
            return undefined;
        }
        if (!fs.existsSync(config.program)) {
            void vscode.window.showErrorMessage(`Cooper: ROM not built: ${config.program}. Run "Cooper: Build (make)" first.`);
            return undefined;
        }

        // Inject the luna binary path (setting → SDK pinned binary).
        const cfg = vscode.workspace.getConfiguration('cooper');
        const sdk = detectSdk({ configured: cfg.get<string>('opensnesPath')?.trim() || undefined, projectDir });
        const luna = resolveLunaPath({ configured: cfg.get<string>('lunaPath')?.trim() || undefined, sdkPath: sdk?.path });
        if (!luna) {
            void vscode.window.showErrorMessage('Cooper: could not find the luna binary. Set cooper.lunaPath or cooper.opensnesPath.');
            return undefined;
        }
        config.lunaPath = luna;
        config.cwd = config.cwd ?? path.dirname(config.program);
        return config;
    }
}

// ---------------------------------------------------------------------------
// Configure clangd (Component #3) — unchanged logic.
// ---------------------------------------------------------------------------

async function generateCompileCommands(): Promise<void> {
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) {
        void vscode.window.showErrorMessage('Cooper: open a project folder first.');
        return;
    }
    const projectDir = folder.uri.fsPath;
    const configured = vscode.workspace.getConfiguration('cooper').get<string>('opensnesPath')?.trim() || undefined;
    const detected = detectSdk({ configured, projectDir });
    if (!detected) {
        void vscode.window.showErrorMessage('Cooper: could not locate the OpenSNES SDK. Set cooper.opensnesPath or run "Cooper: Configure clangd" first.');
        return;
    }

    const uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/*.c'),
        '**/{node_modules,build,dist,.git}/**',
    );
    if (uris.length === 0) {
        void vscode.window.showWarningMessage('Cooper: no .c files found in this project.');
        return;
    }
    const files = uris.map((u) => u.fsPath).sort();

    const target = path.join(projectDir, 'compile_commands.json');
    if (fs.existsSync(target)) {
        const overwrite = await vscode.window.showWarningMessage(`Cooper: ${target} already exists. Overwrite it?`, 'Overwrite');
        if (overwrite !== 'Overwrite') {
            return;
        }
    }
    try {
        fs.writeFileSync(target, renderCompileCommands(detected.path, files));
    } catch (err) {
        void vscode.window.showErrorMessage(`Cooper: failed to write ${target}: ${String(err)}`);
        return;
    }
    void vscode.window.showInformationMessage(
        `Cooper: wrote compile_commands.json (${files.length} file${files.length > 1 ? 's' : ''}, SDK via ${detected.source}). ` +
        'clangd uses it automatically; for the MS C/C++ extension set "C_Cpp.default.compileCommands" to this file.',
    );
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
