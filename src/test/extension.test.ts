// Integration tests — run INSIDE a real VS Code Extension Development Host
// (via @vscode/test-cli), so they exercise the `vscode`-importing glue that the
// Node unit tests (test/run.js) cannot: command registration, and the debug
// adapter factory + config provider wired through the real debug machinery.
//
// The sample workspace (.vscode-test.mjs) is the OpenSNES aim_target example, so
// the luna debug-config provider resolves the ROM and the pinned luna binary
// from its real Makefile.

import * as assert from 'assert';
import * as path from 'path';
import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as vscode from 'vscode';

const EXT_ID = 'opensnes.cooper';

function wait(predicate: () => boolean, timeoutMs: number, label: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const iv = setInterval(() => {
            if (predicate()) {
                clearInterval(iv);
                resolve();
            } else if (Date.now() - started > timeoutMs) {
                clearInterval(iv);
                reject(new Error(`timed out waiting for ${label}`));
            }
        }, 50);
    });
}

suite('Cooper — activation & commands', () => {
    test('extension activates', async () => {
        const ext = vscode.extensions.getExtension(EXT_ID);
        assert.ok(ext, `extension ${EXT_ID} not found`);
        await ext!.activate();
        assert.ok(ext!.isActive, 'extension did not activate');
    });

    test('contributes its commands', async () => {
        await vscode.extensions.getExtension(EXT_ID)!.activate();
        const cmds = await vscode.commands.getCommands(true);
        for (const c of ['cooper.build', 'cooper.preview', 'cooper.configureClangd', 'cooper.refresh', 'cooper.debug', 'cooper.home', 'cooper.openWalkthrough', 'cooper.editPalette', 'cooper.editTiles']) {
            assert.ok(cmds.includes(c), `missing command ${c}`);
        }
    });

    test('contributes a Get Started walkthrough and opens it', async () => {
        const pkg = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
        const wt = pkg.contributes.walkthroughs?.[0] as { id: string; steps: unknown[] } | undefined;
        assert.ok(wt && wt.id === 'cooper.gettingStarted', 'no Get Started walkthrough');
        assert.ok(wt!.steps.length >= 5, 'walkthrough has too few steps');
        await vscode.extensions.getExtension(EXT_ID)!.activate();
        await vscode.commands.executeCommand('cooper.openWalkthrough'); // must not throw
    });

    test('opens the Cooper dashboard webview', async () => {
        await vscode.extensions.getExtension(EXT_ID)!.activate();
        // Must not throw — creates the webview, loads its CSP-gated script.
        await vscode.commands.executeCommand('cooper.home');
    });

    test('symbol breakpoint toggles, never duplicates', async () => {
        await vscode.extensions.getExtension(EXT_ID)!.activate();
        vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
        const count = () => vscode.debug.breakpoints.filter(
            (b) => b instanceof vscode.FunctionBreakpoint && b.functionName === 'enemies_update').length;
        await vscode.commands.executeCommand('cooper.breakOnSymbol', 'enemies_update');
        assert.strictEqual(count(), 1, 'first click should set the breakpoint');
        await vscode.commands.executeCommand('cooper.breakOnSymbol', 'enemies_update');
        assert.strictEqual(count(), 0, 'second click should toggle it off (never duplicate)');
        await vscode.commands.executeCommand('cooper.breakOnSymbol', 'enemies_update');
        assert.strictEqual(count(), 1, 'third click sets it again');
        vscode.debug.removeBreakpoints(vscode.debug.breakpoints);
    });

    test('contributes the Cooper sidebar view', () => {
        const pkg = vscode.extensions.getExtension(EXT_ID)!.packageJSON;
        const containers = pkg.contributes.viewsContainers.activitybar as { id: string }[];
        assert.ok(containers.some((c) => c.id === 'cooper'), 'no Cooper activity-bar container');
        const views = pkg.contributes.views.cooper as { id: string }[];
        assert.ok(views.some((v) => v.id === 'cooperTree'), 'no cooperTree view');
    });

    test('auto-writes .clangd when a C file opens', async () => {
        await vscode.extensions.getExtension(EXT_ID)!.activate();
        const dir = vscode.workspace.workspaceFolders![0].uri.fsPath;
        const clangdPath = path.join(dir, '.clangd');
        if (fs.existsSync(clangdPath)) {
            fs.unlinkSync(clangdPath); // start clean
        }
        try {
            // Opening the C file fires onDidOpenTextDocument -> auto-config writes .clangd.
            await vscode.workspace.openTextDocument(path.join(dir, 'main.c'));
            await wait(() => fs.existsSync(clangdPath), 8000, '.clangd to be auto-written');
            const txt = fs.readFileSync(clangdPath, 'utf8');
            assert.ok(txt.includes('lib/include'), '.clangd missing the SDK include path');
            assert.ok(txt.includes('-std=gnu11'), '.clangd missing -std=gnu11');
        } finally {
            if (fs.existsSync(clangdPath)) {
                fs.unlinkSync(clangdPath); // don't pollute the SDK example dir
            }
        }
    });
});

suite('Cooper — luna debug adapter (real host)', () => {
    let romPath: string;

    suiteSetup(function () {
        const folder = vscode.workspace.workspaceFolders?.[0];
        assert.ok(folder, 'no workspace folder (check .vscode-test.mjs workspaceFolder)');
        const dir = folder!.uri.fsPath;
        romPath = path.join(dir, 'aim_target.sfc');
        if (!fs.existsSync(romPath)) {
            try {
                execFileSync('make', [], { cwd: dir, stdio: 'ignore' });
            } catch { /* surfaced by the existence check below */ }
        }
        if (!fs.existsSync(romPath)) {
            this.skip(); // can't build the example here — skip the live debug test
        }
    });

    test('launch → stop on entry, observed via a DAP tracker', async () => {
        await vscode.extensions.getExtension(EXT_ID)!.activate();

        const messages: { type?: string; event?: string; body?: { reason?: string } }[] = [];
        const tracker = vscode.debug.registerDebugAdapterTrackerFactory('luna', {
            createDebugAdapterTracker() {
                return { onDidSendMessage: (m) => messages.push(m) };
            },
        });

        try {
            const folder = vscode.workspace.workspaceFolders![0];
            // No `program` → the config provider resolves it from the Makefile TARGET,
            // and injects the luna binary path. This exercises the full glue.
            const started = await vscode.debug.startDebugging(folder, {
                type: 'luna',
                request: 'launch',
                name: 'Test: Luna',
                stopOnEntry: true,
            });
            assert.ok(started, 'startDebugging returned false (config provider rejected?)');

            await wait(
                () => messages.some((m) => m.type === 'event' && m.event === 'stopped' && m.body?.reason === 'entry'),
                40000,
                'a stopped(entry) DAP event',
            );

            // The adapter also announces itself ready for breakpoints.
            assert.ok(
                messages.some((m) => m.type === 'event' && m.event === 'initialized'),
                'no initialized event seen',
            );

            // Drive the exact chain VS Code runs to fill the VARIABLES view:
            // threads -> stackTrace -> scopes -> variables. Asserts registers come back.
            const session = vscode.debug.activeDebugSession!;
            const threads = await session.customRequest('threads') as { threads: { id: number }[] };
            assert.ok(threads.threads.length >= 1, 'no threads');
            const st = await session.customRequest('stackTrace', { threadId: threads.threads[0].id }) as { stackFrames: { id: number }[] };
            assert.ok(st.stackFrames.length >= 1, 'no stack frame');
            const scopes = await session.customRequest('scopes', { frameId: st.stackFrames[0].id }) as { scopes: { name: string; variablesReference: number }[] };
            assert.ok(scopes.scopes.length >= 1, 'no scopes');
            const regScope = scopes.scopes.find((s) => s.name === 'Registers') ?? scopes.scopes[0];
            const vars = await session.customRequest('variables', { variablesReference: regScope.variablesReference }) as { variables: { name: string }[] };
            assert.ok(vars.variables.some((v) => v.name === 'PC'), 'Registers/VARIABLES has no PC');

            // Palette viewer (P2.2c): the custom request feeds the live CGRAM, and
            // the command renders a webview — both through the real host.
            const active = vscode.debug.activeDebugSession;
            assert.ok(active && active.type === 'luna', 'no active luna session');
            const ppu = await active!.customRequest('cooperPpu') as { cgram?: number[]; oam?: number[] };
            assert.strictEqual(ppu.cgram?.length, 256, 'cooperPpu should return 256 CGRAM words');
            assert.strictEqual(ppu.oam?.length, 544, 'cooperPpu should return 544-byte OAM');
            await vscode.commands.executeCommand('cooper.showPalette'); // creates a webview; must not throw
            await vscode.commands.executeCommand('cooper.showOam');     // ditto
            await vscode.commands.executeCommand('cooper.showVram');    // decodes VRAM -> PNG -> webview
        } finally {
            await vscode.debug.stopDebugging();
            tracker.dispose();
        }
    });
});
