import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { detectSdk, renderClangd, isOpenSnesRoot, SdkSource } from './clangdConfig';

export function activate(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('cooper.configureClangd', () => configureClangd()),
    );
}

export function deactivate(): void {
    // nothing to clean up
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
            void vscode.window.showErrorMessage(`Cooper: ${chosen} is not an OpenSNES SDK root (missing lib/include/snes/snes.h).`);
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
