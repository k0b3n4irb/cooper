import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));
// Open a real OpenSNES example as the workspace, so the luna debug-config
// provider resolves the ROM (Makefile TARGET) and the pinned luna binary
// (Makefile OPENSNES → <sdk>/tools/luna-test/bin/luna) from real files.
const sampleWorkspace = resolve(root, '../opensnes/examples/basics/aim_target');

export default defineConfig({
    files: 'out/test/**/*.test.js',
    workspaceFolder: sampleWorkspace,
    // Not root here, so no --no-sandbox; isolate from any host extensions.
    launchArgs: ['--disable-extensions', '--disable-gpu'],
    mocha: {
        ui: 'tdd',
        timeout: 60000,
    },
});
