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
        for (const c of ['cooper.build', 'cooper.preview', 'cooper.configureClangd', 'cooper.generateCompileCommands']) {
            assert.ok(cmds.includes(c), `missing command ${c}`);
        }
    });

    test('generates a compile_commands.json for the workspace', async () => {
        await vscode.extensions.getExtension(EXT_ID)!.activate();
        const dir = vscode.workspace.workspaceFolders![0].uri.fsPath;
        const ccPath = path.join(dir, 'compile_commands.json');
        if (fs.existsSync(ccPath)) {
            fs.unlinkSync(ccPath); // avoid the overwrite prompt (no user in headless)
        }
        try {
            await vscode.commands.executeCommand('cooper.generateCompileCommands');
            assert.ok(fs.existsSync(ccPath), 'compile_commands.json not written');
            const entries = JSON.parse(fs.readFileSync(ccPath, 'utf8'));
            assert.ok(Array.isArray(entries) && entries.length >= 1, 'no entries');
            assert.ok(entries.every((e: { file: string; arguments: string[] }) => e.file.endsWith('.c') && e.arguments.includes('-std=gnu11')), 'bad entry shape');
        } finally {
            if (fs.existsSync(ccPath)) {
                fs.unlinkSync(ccPath); // don't pollute the SDK example dir
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
