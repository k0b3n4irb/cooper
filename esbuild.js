const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** @type {import('esbuild').Plugin} */
const esbuildProblemMatcherPlugin = {
  name: 'esbuild-problem-matcher',
  setup(build) {
    build.onStart(() => console.log('[watch] build started'));
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`✘ [ERROR] ${text}`);
        if (location == null) return;
        console.error(`    ${location.file}:${location.line}:${location.column}:`);
      });
      console.log('[watch] build finished');
    });
  },
};

const common = {
  bundle: true,
  format: 'cjs',
  minify: production,
  sourcemap: !production,
  sourcesContent: false,
  platform: 'node',
  logLevel: 'warning',
  plugins: [esbuildProblemMatcherPlugin],
};

async function main() {
  const ctxs = await Promise.all([
    // The extension (imports vscode → external).
    esbuild.context({ ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] }),
    // The OpenSNES MCP server — a standalone Node process the AI spawns (no vscode).
    esbuild.context({ ...common, entryPoints: ['src/opensnesMcp.ts'], outfile: 'dist/opensnes-mcp.js' }),
  ]);
  if (watch) {
    await Promise.all(ctxs.map((c) => c.watch()));
  } else {
    await Promise.all(ctxs.map((c) => c.rebuild()));
    await Promise.all(ctxs.map((c) => c.dispose()));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
