// Node test for the pure clangdConfig module. Compiles the TS to a temp CJS via
// esbuild, requires it, asserts against the real OpenSNES repo, and closes the
// loop by running `clang` with the *generated* flags on a real example.
//
// Usage: OPENSNES=/path/to/opensnes node test/run.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const esbuild = require('esbuild');

const OPENSNES = process.env.OPENSNES || '/home/kobenairb/workspace/opensnes';

// --- compile the pure module to a temp CJS and require it ---
const tmp = path.join(os.tmpdir(), `cooper_clangdConfig_${process.pid}.cjs`);
esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'clangdConfig.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: tmp,
});
const C = require(tmp);

let pass = 0, fail = 0;
function check(name, cond) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}`); }
}

const helloDir = path.join(OPENSNES, 'examples', 'text', 'hello_world');

console.log('=== pure-module assertions ===');
check('isOpenSnesRoot(SDK) is true', C.isOpenSnesRoot(OPENSNES) === true);
check('isOpenSnesRoot(/tmp) is false', C.isOpenSnesRoot(os.tmpdir()) === false);

const mk = fs.readFileSync(path.join(helloDir, 'Makefile'), 'utf8');
check('sdkPathFromMakefile resolves shell form to SDK root',
    C.sdkPathFromMakefile(mk, helloDir) === OPENSNES);

const det = C.detectSdk({ projectDir: helloDir });
check('detectSdk via Makefile finds SDK root', det && det.path === OPENSNES && det.source === 'makefile');

check('detectSdk prefers a valid setting',
    C.detectSdk({ configured: OPENSNES, projectDir: os.tmpdir() }).source === 'setting');

check('searchUpForSdk from lib/source finds SDK root',
    C.searchUpForSdk(path.join(OPENSNES, 'lib', 'source')) === OPENSNES);

const rendered = C.renderClangd(OPENSNES);
check('renderClangd includes lib/include path',
    rendered.includes(`-I${path.join(OPENSNES, 'lib', 'include')}`));
check('renderClangd includes -std=gnu11', rendered.includes('-std=gnu11'));
check('renderClangd has no -D__OPENSNES__', !rendered.includes('__OPENSNES__'));

// --- close the loop: the GENERATED flags must actually parse a real example ---
console.log('\n=== generated config actually parses an example (clang) ===');
const flags = [...rendered.matchAll(/- "([^"]+)"/g)].map((m) => m[1]);
const main = path.join(helloDir, 'main.c');
const hasClang = cp.spawnSync('clang', ['--version']).status === 0;
if (!hasClang) {
    console.log('  SKIP  clang not available');
} else {
    // clangd resolves "-I." relative to the file's dir; emulate by adding -I<helloDir>
    const r = cp.spawnSync('clang', ['-fsyntax-only', ...flags, `-I${helloDir}`, main], { encoding: 'utf8' });
    check('clang parses hello_world with generated flags', r.status === 0);
    if (r.status !== 0) console.log(r.stderr.split('\n').slice(0, 5).join('\n'));
}

try { fs.unlinkSync(tmp); } catch {}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
