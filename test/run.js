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

let pass = 0, fail = 0, skip = 0;
function check(name, cond) {
    if (cond) { pass++; console.log(`  PASS  ${name}`); }
    else { fail++; console.log(`  FAIL  ${name}`); }
}
// A skipped group means an external tool was absent, so the run did NOT cover
// that path. Always counted and reported; with COOPER_REQUIRE_TOOLS=1 (CI) any
// skip fails the run — green must mean covered.
function skipped(what) {
    skip++;
    console.log(`  SKIP  ${what}`);
}

if (!fs.existsSync(path.join(OPENSNES, 'lib', 'include', 'snes.h'))) {
    console.error(`FATAL: OpenSNES SDK not found at ${OPENSNES} — set OPENSNES=/path/to/opensnes (dev tree).`);
    process.exit(1);
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

// findProjectDir: resolve the project from the active file, even in a subfolder
check('findProjectDir finds the example (Makefile w/ OPENSNES)',
    C.findProjectDir(helloDir) === helloDir);
check('findProjectDir walks up from a subdir of the project',
    C.findProjectDir(path.join(helloDir, 'res', 'gfx')) === helloDir);
check('findProjectDir is null outside any OpenSNES project',
    C.findProjectDir(os.tmpdir()) === null);

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
    skipped('clang not available');
} else {
    // clangd resolves "-I." relative to the file's dir; emulate by adding -I<helloDir>
    const r = cp.spawnSync('clang', ['-fsyntax-only', ...flags, `-I${helloDir}`, main], { encoding: 'utf8' });
    check('clang parses hello_world with generated flags', r.status === 0);
    if (r.status !== 0) console.log(r.stderr.split('\n').slice(0, 5).join('\n'));
}

try { fs.unlinkSync(tmp); } catch {}

// ===========================================================================
// Component #4 (P0) — build/preview pure logic + closing-the-loop with luna.
// ===========================================================================
const tmpB = path.join(os.tmpdir(), `cooper_build_${process.pid}.cjs`);
esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'build.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: tmpB,
});
const B = require(tmpB);

const aimDir = path.join(OPENSNES, 'examples', 'basics', 'aim_target');

console.log('\n=== build module: pure assertions ===');
const aimMk = fs.readFileSync(path.join(aimDir, 'Makefile'), 'utf8');
check('romTargetFromMakefile reads TARGET := aim_target.sfc',
    B.romTargetFromMakefile(aimMk) === 'aim_target.sfc');
check('romTargetFromMakefile null on unresolved $(VAR)',
    B.romTargetFromMakefile('TARGET := $(NAME).sfc') === null);

const ri = B.findRomForDir(aimDir);
check('findRomForDir resolves the example ROM',
    ri && ri.dir === aimDir && ri.rom === path.join(aimDir, 'aim_target.sfc'));
check('findRomForDir walks up from a subdir',
    (B.findRomForDir(path.join(aimDir, 'nope-subdir')) || {}).rom === path.join(aimDir, 'aim_target.sfc'));

check('resolveLunaPath finds the SDK pinned binary',
    B.resolveLunaPath({ sdkPath: OPENSNES }) === path.join(OPENSNES, 'tools', 'luna-test', 'bin', 'luna'));
check('resolveLunaPath prefers a valid setting',
    B.resolveLunaPath({ configured: path.join(OPENSNES, 'tools', 'luna-test', 'bin', 'luna') })
        === path.join(OPENSNES, 'tools', 'luna-test', 'bin', 'luna'));

const pArgs = B.lunaPreviewArgs('/x/rom.sfc', '/x/out.png', { steps: 200000 });
check('lunaPreviewArgs builds the grounded run argv',
    JSON.stringify(pArgs) === JSON.stringify(
        ['run', '--steps', '200000', '--screenshot', '/x/out.png', '--force-display', '/x/rom.sfc']));
check('lunaPreviewArgs honours forceDisplay:false',
    !B.lunaPreviewArgs('r', 'p', { forceDisplay: false }).includes('--force-display'));
const bmaRel = B.buildMakeArgs('/sdk');
check('buildMakeArgs release: OPENSNES first', bmaRel[0] === 'OPENSNES=/sdk');
check('buildMakeArgs release: NO debug flags (= shipped ROM)', !bmaRel.some((x) => / -i$| -A$/.test(x)));
const bmaDbg = B.buildMakeArgs('/sdk', undefined, true);
check('buildMakeArgs debug: adds wla -i (asm line info)', bmaDbg.some((x) => /\/bin\/wla-65816 -i$/.test(x)));
check('buildMakeArgs debug: adds wlalink -A (addr-to-line)', bmaDbg.some((x) => /\/bin\/wlalink -A$/.test(x)));
check('buildMakeArgs appends the target last', B.buildMakeArgs('/sdk', 'clean').slice(-1)[0] === 'clean');
check('buildMakeArgs without an sdk is empty', JSON.stringify(B.buildMakeArgs()) === '[]');
// close the loop: `make OPENSNES=<sdk>` actually builds (the override beats the
// Makefile's wrong $(shell cd ../../..) for out-of-tree projects)
if (fs.existsSync(path.join(OPENSNES, 'make', 'common.mk'))) {
    cp.spawnSync('make', B.buildMakeArgs(OPENSNES, 'clean'), { cwd: aimDir });
    const rb = cp.spawnSync('make', B.buildMakeArgs(OPENSNES), { cwd: aimDir, encoding: 'utf8' });
    check('make OPENSNES=<sdk> builds the ROM', rb.status === 0 && fs.existsSync(ri.rom));
}

// --- luna resolution robustness (the real bug: lunaPath was a DIRECTORY) ---
console.log('\n=== luna resolution (file / directory / PATH) ===');
const lunaDir = path.join(os.tmpdir(), `cooper_lunadir_${process.pid}`);
fs.mkdirSync(lunaDir, { recursive: true });
fs.writeFileSync(path.join(lunaDir, 'luna'), '#!/bin/sh\n');
check('resolveLunaPath accepts a DIRECTORY containing luna (the user case)',
    B.resolveLunaPath({ configured: lunaDir }) === path.join(lunaDir, 'luna'));
check('resolveLunaPath accepts the binary file directly',
    B.resolveLunaPath({ configured: path.join(lunaDir, 'luna') }) === path.join(lunaDir, 'luna'));
const savedPath = process.env.PATH;
process.env.PATH = lunaDir + path.delimiter + (savedPath || '');
check('resolveLunaPath finds luna on PATH', B.resolveLunaPath({}) === path.join(lunaDir, 'luna'));
process.env.PATH = '';
check('resolveLunaPath returns null when nothing is found',
    B.resolveLunaPath({ configured: '/no/such', sdkPath: '/no/such' }) === null);
process.env.PATH = savedPath;
fs.rmSync(lunaDir, { recursive: true, force: true });

// --- a STANDALONE (out-of-tree) project builds via the OPENSNES override ---
console.log('\n=== standalone project fixture (out-of-tree) builds ===');
const fixDir = path.join(__dirname, 'fixtures', 'standalone');
check('findProjectDir resolves the standalone fixture', C.findProjectDir(fixDir) === fixDir);
if (fs.existsSync(path.join(OPENSNES, 'make', 'common.mk'))) {
    cp.spawnSync('make', B.buildMakeArgs(OPENSNES, 'clean'), { cwd: fixDir });
    const rs = cp.spawnSync('make', B.buildMakeArgs(OPENSNES), { cwd: fixDir, encoding: 'utf8' });
    check('standalone project builds (OPENSNES override beats $(shell cd ../../..))',
        rs.status === 0 && fs.existsSync(path.join(fixDir, 'hello_world.sfc')));
    if (rs.status !== 0) { console.log(rs.stderr.split('\n').slice(0, 6).join('\n')); }
}

// --- close the loop: the cooper-cc matcher regex must capture a REAL cc65816 error ---
console.log('\n=== problem matcher catches a real cc65816 error ===');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const cc = (pkg.contributes.problemMatchers || []).find((m) => m.name === 'cooper-cc');
check('package.json contributes the cooper-cc matcher', !!cc);
const cc65816 = path.join(OPENSNES, 'bin', 'cc65816');
if (cc && fs.existsSync(cc65816)) {
    const brokenC = path.join(os.tmpdir(), `cooper_broken_${process.pid}.c`);
    fs.writeFileSync(brokenC, 'int main(void) { return @; }\n');
    const r = cp.spawnSync(cc65816, [brokenC, '-o', path.join(os.tmpdir(), `cooper_broken_${process.pid}.asm`)], { encoding: 'utf8' });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    const re = new RegExp(cc.pattern.regexp);
    const line = out.split('\n').find((l) => re.test(l));
    check('cc65816 emitted a gcc-style error line', !!line);
    if (line) {
        const m = line.match(re);
        check('matcher captures file/line/col/severity', m[cc.pattern.line] && m[cc.pattern.column] && /error|warning/.test(m[cc.pattern.severity]));
    }
    try { fs.unlinkSync(brokenC); } catch {}
} else {
    skipped('cc65816 not available');
}

// --- close the loop: luna renders a NON-BLACK preview of the real ROM ---
console.log('\n=== luna renders a non-black preview of the real ROM ===');
const luna = B.resolveLunaPath({ sdkPath: OPENSNES });
if (luna && fs.existsSync(luna)) {
    if (!fs.existsSync(ri.rom)) {
        console.log('  (building aim_target first)');
        cp.spawnSync('make', [], { cwd: aimDir, encoding: 'utf8' });
    }
    const outPng = path.join(os.tmpdir(), `cooper_preview_${process.pid}.png`);
    const r = cp.spawnSync(luna, B.lunaPreviewArgs(ri.rom, outPng, { steps: 200000 }), { cwd: aimDir, encoding: 'utf8' });
    check('luna run exited 0', r.status === 0);
    const size = fs.existsSync(outPng) ? fs.statSync(outPng).size : 0;
    // A black 256x224 frame compresses to ~1.4 KB; a rendered frame is larger.
    check(`luna produced a non-black preview PNG (${size} bytes > 2000)`, size > 2000);
    try { fs.unlinkSync(outPng); } catch {}
} else {
    skipped('luna binary not available');
}

try { fs.unlinkSync(tmpB); } catch {}

// ===========================================================================
// P2.1a — the WLA .sym parser (symbol layer for the ASM debugger).
// ===========================================================================
const tmpS = path.join(os.tmpdir(), `cooper_sym_${process.pid}.cjs`);
esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'sym.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: tmpS,
});
const S = require(tmpS);

console.log('\n=== .sym parser: against the real aim_target.sym ===');
const symPath = path.join(aimDir, 'aim_target.sym');
// Build with -i (asm list info) + -A (addr-to-line) so the .sym carries source
// line info; the patched cproc emits `; @cline N` markers we join against.
const asI = `${path.join(OPENSNES, 'bin', 'wla-65816')} -i`;
const ldA = `${path.join(OPENSNES, 'bin', 'wlalink')} -A`;
cp.spawnSync('make', [`OPENSNES=${OPENSNES}`, 'clean'], { cwd: aimDir });
// CC65816_G=1 keeps C locals memory-resident (and emits `; @dbglocal`) for G4.
cp.spawnSync('make', [`OPENSNES=${OPENSNES}`, `AS=${asI}`, `LD=${ldA}`], { cwd: aimDir, env: { ...process.env, CC65816_G: '1' } });
const sym = S.parseSym(fs.readFileSync(symPath, 'utf8'));
check('parses many labels (>500)', sym.labels.length > 500);
check('[information] wlasymbol=true', sym.info.wlasymbol === 'true');

// Forward: C symbols resolve to their addresses.
const initAddr = S.symbolToAddr(sym, 'InitHardware');
check('symbolToAddr(InitHardware) === 0x008365', initAddr === 0x008365);
check('symbolToAddr(main) is defined', typeof S.symbolToAddr(sym, 'main') === 'number');

// Names with @ / . survive (cproc/QBE block labels), split on first space only.
const blockLabel = sym.labels.find((l) => l.name.includes('@'));
check('block label with @ kept intact', !!blockLabel && /@/.test(blockLabel.name));

// Reverse: the PC that wrote $2100 in the live run (0x836B) -> InitHardware+6.
const res = S.addrToSymbol(sym, 0x00836B);
check('addrToSymbol(0x836B) -> InitHardware', res && res.name === 'InitHardware');
check('addrToSymbol(0x836B) delta === 6', res && res.delta === 6);
check('formatResolved -> "InitHardware+6"', res && S.formatResolved(res) === 'InitHardware+6');
check('exact-hit delta is 0', S.addrToSymbol(sym, initAddr).delta === 0);

check('sections parsed (ROM + RAM)', sym.sections.some((s) => s.kind === 'rom') && sym.sections.some((s) => s.kind === 'ram'));

// Source-level: with -i/-A + the patched cproc, the .sym carries line info, and
// buildCLineMap joins PC -> generated-asm:line -> C:line (via `; @cline`).
check('hasLineInfo is true (built with -i/-A)', sym.hasLineInfo === true);
check('[source files] includes main.c.wrap.asm', [...sym.sourceFiles.values()].some((f) => f.includes('main.c')));
const wrapAsm = fs.readFileSync(path.join(aimDir, 'main.c.wrap.asm'), 'utf8');
check('the generated asm carries @cline markers', /;\s*@cline\s+\d+/.test(wrapAsm));
const clmap = S.buildCLineMap(sym, new Map([['main.c.wrap.asm', wrapAsm]]));
check('buildCLineMap maps many PCs to C source', clmap.addrToSource.size > 20);
const mainCLines = fs.readFileSync(path.join(aimDir, 'main.c'), 'utf8').split('\n').length;
const [someAddr, someSrc] = [...clmap.addrToSource][0];
check('mapped C file is main.c', someSrc.file === 'main.c');
check('mapped C line is within main.c', someSrc.line > 0 && someSrc.line <= mainCLines);
check('cSourceForAddr resolves nearest-below', !!S.cSourceForAddr(clmap, someAddr + 1));
const k = `main.c:${someSrc.line}`;
check('sourceToAddr round-trips (lowest PC <= entry)', clmap.sourceToAddr.has(k) && clmap.sourceToAddr.get(k) <= someAddr);

// Typed locals (G4): `; @dbglocal` markers parsed per function from the -g build.
const localsMap = S.parseLocals(wrapAsm);
check('parseLocals finds functions with locals', localsMap.size > 0);
check('on_update has typed locals (pad/dx)', (localsMap.get('on_update') || []).some((l) => l.name === 'pad'));
const padLoc = (localsMap.get('on_update') || []).find((l) => l.name === 'pad');
check('local pad decoded (u, 2 bytes, frame offset)', !!padLoc && padLoc.cls === 'u' && padLoc.size === 2 && padLoc.offset > 0);
check('struct local cfg in main is class g', (localsMap.get('main') || []).some((l) => l.name === 'cfg' && l.cls === 'g'));
// names with underscores survive (split type code off the front only)
check('parseLocals keeps underscored C names', (localsMap.get('on_update') || []).some((l) => /_/.test(l.name)));

// Aggregate layouts (.dbg sidecar): struct/array type trees for expansion.
const dbgPath = path.join(aimDir, 'main.c.dbg');
const aggs = fs.existsSync(dbgPath) ? S.parseAggregates(fs.readFileSync(dbgPath, 'utf8')) : new Map();
const cfg = aggs.get('main cfg');
check('parseAggregates finds struct cfg (from the real -g build)', !!cfg && cfg.kind === 'struct');
check('cfg has init/update fields at offsets 0/4', !!cfg && cfg.fields.length === 2 && cfg.fields[0].name === 'init' && cfg.fields[1].name === 'update' && cfg.fields[1].off === 4);
const arrAgg = S.parseAggregates('loc f buf a20[u2;10]').get('f buf');
check('parseAggregates array: 10 × u16', arrAgg.kind === 'array' && arrAgg.count === 10 && arrAgg.elem.size === 2 && arrAgg.elem.cls === 'u');
const nestedAgg = S.parseAggregates('loc f e g6{pos:g4{x:s2@0;y:s2@2;}@0;hp:u2@4;}').get('f e');
check('parseAggregates nested struct', nestedAgg.kind === 'struct' && nestedAgg.fields[0].type.kind === 'struct' && nestedAgg.fields[0].type.fields[1].name === 'y' && nestedAgg.fields[1].off === 4);

// address parsing + expression resolution (for evaluate / memory view)
check('parseAddress($008365)', S.parseAddress('$008365') === 0x008365);
check('parseAddress(0x7E0030)', S.parseAddress('0x7E0030') === 0x7E0030);
check('parseAddress(7E:0030)', S.parseAddress('7E:0030') === 0x7E0030);
check('parseAddress(garbage) undefined', S.parseAddress('zzz') === undefined);
check('resolveExpr(symbol) wins', S.resolveExpr(sym, 'InitHardware') === 0x008365);
check('resolveExpr(literal) falls through', S.resolveExpr(sym, '$7E0030') === 0x7E0030);
try { fs.unlinkSync(tmpS); } catch {}

// --- Cooper sidebar model (pure) ---
console.log('\n=== Cooper sidebar tree model (pure) ===');
const tmpSB = path.join(os.tmpdir(), `cooper_sidebar_${process.pid}.cjs`);
esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'sidebar.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: tmpSB,
});
const SB = require(tmpSB);
check('extractCFunctions finds a definition',
    SB.extractCFunctions('static void enemies_update(void) {\n}').includes('enemies_update'));
check('extractCFunctions ignores a call/decl',
    !SB.extractCFunctions('foo();\nint x = bar(1);').includes('foo'));
// userFunctions = C defs that are real in the .sym — `main` exists in aim_target
const aimMainC = fs.readFileSync(path.join(aimDir, 'main.c'), 'utf8');
const ufns = SB.userFunctions([aimMainC], sym);
check('userFunctions intersects C defs with the .sym (main present)',
    ufns.some((f) => f.name === 'main' && typeof f.addr === 'number'));
const model = SB.buildTreeModel({ projectDir: '/x', romName: 'game.sfc', romBuilt: true, sdkName: 'opensnes', functions: [{ name: 'foo', addr: 0x8000 }] });
check('tree has 4 categories', model.length === 4 && model.every((n) => n.kind === 'category'));
check('PROJECT shows the built ROM', model[0].children.find((c) => c.id === 'rom').description === '✓ built');
check('Build action runs cooper.build', model[1].children.find((c) => c.id === 'build').commandId === 'cooper.build');
check('Palette action runs cooper.showPalette', model[2].children.find((c) => c.id === 'palette').commandId === 'cooper.showPalette');
check('symbol click sets a breakpoint', model[3].children[0].commandId === 'cooper.breakOnSymbol' && model[3].children[0].args[0] === 'foo');
check('no project -> single info node', SB.buildTreeModel({ projectDir: null, romName: null, romBuilt: false, sdkName: null, functions: [] }).length === 1);
try { fs.unlinkSync(tmpSB); } catch {}

// --- walkthrough manifest + media (catches blank-box / unpackaged media) ---
console.log('\n=== Get Started walkthrough ===');
const pkgWt = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
const wt = (pkgWt.contributes.walkthroughs || [])[0];
check('walkthrough is contributed', !!wt && wt.id === 'cooper.gettingStarted');
check('walkthrough has steps', !!wt && wt.steps.length >= 5);
const repoRoot = path.join(__dirname, '..');
const missingMedia = (wt ? wt.steps : []).filter((s) => !s.media || !s.media.image || !fs.existsSync(path.join(repoRoot, s.media.image)));
check('every step media image exists (no blank boxes)', missingMedia.length === 0);
if (missingMedia.length) { console.log('  missing:', missingMedia.map((s) => s.media && s.media.image)); }
check('media live under media/ (packaged, not docs/)', (wt ? wt.steps : []).every((s) => s.media.image.startsWith('media/')));

// --- Cooper Home dashboard HTML (pure) ---
console.log('\n=== Cooper dashboard HTML (pure) ===');
const tmpD2 = path.join(os.tmpdir(), `cooper_dash_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'dashboard.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpD2 });
const D2 = require(tmpD2);
const dash = D2.renderDashboardHtml({ hasProject: true, projectName: 'shmup_1942', romBuilt: true, sdkName: 'opensnes', lunaFound: true }, 'vscode-csp', 'NONCE0');
check('dashboard has Build/Run/Play/Debug + viewer cards + refresh (9 actions)', (dash.match(/data-cmd=/g) || []).length === 9);
check('dashboard has the Play button (luna-gui)', dash.includes('data-cmd="play"'));
check('dashboard has a real status refresh (not the preview button)', dash.includes('data-cmd="refresh"'));
check('dashboard announces ready (extension re-posts the cached preview)', dash.includes("{ command: 'ready' }"));
check('dashboard script gated by a nonce (CSP)', dash.includes("script-src 'nonce-NONCE0'") && dash.includes('nonce="NONCE0"'));
check('dashboard allows data: images for the preview', dash.includes('img-src vscode-csp data:'));
check('dashboard reflects status (luna ready, ROM built)', dash.includes('ready') && dash.includes('built'));
check('dashboard has a preview image slot', dash.includes('id="preview"'));
const dashEmpty = D2.renderDashboardHtml({ hasProject: false, projectName: '', romBuilt: false, sdkName: null, lunaFound: false }, 'csp', 'N');
check('dashboard empty state when no project', dashEmpty.includes('Open an OpenSNES project'));
check('dashboard empty state offers New Project (nonce-gated script)',
    dashEmpty.includes('id="new-project"') && dashEmpty.includes('nonce="N"'));

// --- disassembly viewer HTML (pure) ---
console.log('\n=== disassembly viewer HTML (pure) ===');
const tmpDs = path.join(os.tmpdir(), `cooper_disasm_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'disasmView.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpDs });
const DS = require(tmpDs);
check('formatDisasmAddr renders $BB:AAAA', DS.formatDisasmAddr(0x00C46E) === '$00:C46E');
const dhtml = DS.renderDisasmHtml([
    { addr: 0x00C46E, bytes: [0xA9, 0x12], text: 'LDA #$12', is_pc: true, symbol: 'main' },
    { addr: 0x00C470, bytes: [0x60], text: 'RTS <x>', is_pc: false, symbol: null },
], 'vscode-csp');
check('disasm html highlights the PC row', dhtml.includes('<tr class="pc">'));
check('disasm html shows the symbol column', dhtml.includes('>main</td>'));
check('disasm html escapes instruction text', dhtml.includes('RTS &lt;x&gt;'));
check('disasm html title carries the live PC', dhtml.includes('PC $00:C46E'));
check('disasm html is static (CSP, no scripts)', dhtml.includes("default-src 'none'") && !dhtml.includes('<script'));
try { fs.unlinkSync(tmpDs); } catch {}

// --- memory-trace viewer HTML (pure) ---
console.log('\n=== memory-trace viewer HTML (pure) ===');
const tmpMt = path.join(os.tmpdir(), `cooper_memtrace_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'memTraceView.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpMt });
const MT = require(tmpMt);
const mthtml = MT.renderMemTraceHtml('frame_count', 0x7E0030, [
    { mclk: 1, pc: 0x00C480, addr: 0x7E0030, kind: 'write', value: 0x2A, line: 42, hclock: 0, blank: true, force_blank: false, pcSymbol: 'on_update' },
    { mclk: 2, pc: 0x00C490, addr: 0x7E0030, kind: 'read', value: 0x2A, line: 43, hclock: 0, blank: false, force_blank: false, pcSymbol: null },
], 'vscode-csp');
check('mem-trace html titles the expr + resolved addr', mthtml.includes('frame_count') && mthtml.includes('$7E:0030'));
check('mem-trace html names the accessing function', mthtml.includes('>on_update</td>'));
check('mem-trace html shows kind + value + vblank', mthtml.includes('write') && mthtml.includes('$2A') && mthtml.includes('42 (vblank)'));
check('mem-trace html empty state', MT.renderMemTraceHtml('x', 0, [], 'csp').includes('No access'));
check('mem-trace html is static (no scripts)', !mthtml.includes('<script'));
try { fs.unlinkSync(tmpMt); } catch {}

// --- New Project (D-050): SDK-example scaffolding, closing the loop with make ---
console.log('\n=== New Project: list, rewrite, scaffold → real make ===');
const tmpNp = path.join(os.tmpdir(), `cooper_newproject_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'newProject.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpNp });
const NP = require(tmpNp);
const examples = NP.listExamples(OPENSNES);
check('listExamples finds a real corpus (>10)', examples.length > 10);
check('listExamples includes text/hello_world', examples.some((e) => e.id === 'text/hello_world'));
check('listExamples reaches nested categories (graphics/*/*)', examples.some((e) => e.id.split('/').length === 3));
check('validateProjectName accepts my-game, rejects "a b"',
    NP.validateProjectName('my-game') === undefined && NP.validateProjectName('a b') !== undefined);
check('isBuildArtifact: .o/.sfc/.wrap.asm/linkfile yes, main.c/data.asm no',
    NP.isBuildArtifact('main.c.o') && NP.isBuildArtifact('x.sfc') && NP.isBuildArtifact('crt0.wrap.asm')
    && NP.isBuildArtifact('linkfile') && !NP.isBuildArtifact('main.c') && !NP.isBuildArtifact('data.asm'));
const helloMk = fs.readFileSync(path.join(OPENSNES, 'examples', 'text', 'hello_world', 'Makefile'), 'utf8');
const rewritten = NP.rewriteMakefile(helloMk, 'my-game', OPENSNES);
check('rewriteMakefile pins OPENSNES ?= <sdk>', rewritten.includes(`OPENSNES ?= ${OPENSNES}`)
    && !rewritten.includes('$(shell cd'));
check('rewriteMakefile renames TARGET', /TARGET\s*:?=\s*my-game\.sfc/.test(rewritten));
check('rewriteMakefile uppercases ROM_NAME (≤21)', /ROM_NAME\s*:?=\s*MY-GAME$/m.test(rewritten));
// close the loop: scaffold out-of-tree, then the SDK's own make builds it
const npDest = path.join(os.tmpdir(), `cooper_np_${process.pid}`, 'my-game');
try {
    const copied = NP.scaffoldProject(path.join(OPENSNES, 'examples', 'text', 'hello_world'), npDest, 'my-game', OPENSNES);
    check('scaffold copies sources', copied >= 2 && fs.existsSync(path.join(npDest, 'main.c')));
    check('scaffold copies no build artifacts',
        !fs.readdirSync(npDest).some((f) => NP.isBuildArtifact(f)));
    const npMake = cp.spawnSync('make', [], { cwd: npDest, encoding: 'utf8', timeout: 120000 });
    check('scaffolded project builds with plain make (OPENSNES ?= works)',
        npMake.status === 0 && fs.existsSync(path.join(npDest, 'my-game.sfc')));
    if (npMake.status !== 0) { console.log((npMake.stderr || npMake.stdout || '').split('\n').slice(-8).join('\n')); }
} finally {
    try { fs.rmSync(path.dirname(npDest), { recursive: true, force: true }); } catch {}
}
try { fs.unlinkSync(tmpNp); } catch {}

// --- G10 v1: WAV encoder (pure) ---
console.log('\n=== audition: encodeWav / nonSilentRatio ===');
const tmpWv = path.join(os.tmpdir(), `cooper_wav_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'wav.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpWv });
const WV = require(tmpWv);
const wav = WV.encodeWav([100, -100, 32767, -32768], 32000);
check('wav: RIFF/WAVE/fmt/data structure', wav.slice(0, 4).toString() === 'RIFF'
    && wav.slice(8, 12).toString() === 'WAVE' && wav.slice(36, 40).toString() === 'data');
check('wav: PCM16 stereo @32kHz header fields',
    wav.readUInt16LE(20) === 1 && wav.readUInt16LE(22) === 2 && wav.readUInt32LE(24) === 32000
    && wav.readUInt16LE(34) === 16 && wav.readUInt32LE(40) === 8);
check('wav: samples written little-endian with clamping',
    wav.readInt16LE(44) === 100 && wav.readInt16LE(48) === 32767
    && WV.encodeWav([40000], 32000).readInt16LE(44) === 32767);
check('nonSilentRatio', WV.nonSilentRatio([0, 0, 5, -5]) === 0.5 && WV.nonSilentRatio([]) === 0);
try { fs.unlinkSync(tmpWv); } catch {}

// --- G7: frame profiler aggregation (pure) ---
console.log('\n=== profiler: aggregateProfile ===');
const tmpPf = path.join(os.tmpdir(), `cooper_profiler_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'profiler.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpPf });
const PF = require(tmpPf);
check('baseSymbol strips +0xNN', PF.baseSymbol('enemies_update+0x12') === 'enemies_update'
    && PF.baseSymbol(null) === '(no symbol)');
const prof = PF.aggregateProfile([
    { mclk: 0, pc: 1, symbol: 'main' },          // cost 10
    { mclk: 10, pc: 2, symbol: 'main+0x04' },    // cost 20
    { mclk: 30, pc: 3, symbol: 'draw' },         // cost 30 (to frameEnd 60)
], 60);
check('costs are mclk deltas grouped by base symbol',
    prof.rows[0].name === 'main' && prof.rows[0].cycles === 30 && prof.rows[0].instructions === 2
    && prof.rows[1].name === 'draw' && prof.rows[1].cycles === 30);
check('percentages sum to ~100', Math.round(prof.rows.reduce((a, r) => a + r.pct, 0)) === 100);
check('scanline strip covers the span', prof.scanlines.length === 1 && prof.scanlines[0] === 60);
const pfHtml = PF.renderProfileHtml(prof, 'csp');
check('profile html: totals + strip, no scripts',
    pfHtml.includes('master clocks') && pfHtml.includes('class="cell"') && !pfHtml.includes('<script'));
try { fs.unlinkSync(tmpPf); } catch {}

// --- G6: ROM validation (pure, vs real wlalink-built ROMs) ---
console.log('\n=== ROM check: header / checksum ===');
const tmpRc = path.join(os.tmpdir(), `cooper_romcheck_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'romCheck.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpRc });
const RC = require(tmpRc);
const romsToCheck = ['basics/aim_target/aim_target.sfc', 'games/breakout/breakout.sfc', 'games/likemario/likemario.sfc']
    .map((r) => path.join(OPENSNES, 'examples', r)).filter((p) => fs.existsSync(p));
check('a real ROM corpus is available', romsToCheck.length >= 2);
const reports = romsToCheck.map((p) => RC.checkRom(fs.readFileSync(p)));
check('every SDK-built ROM validates clean (LoROM, all items OK)',
    reports.every((r) => r.ok && r.mapping === 'LoROM'));
check('titles read back ("AIM TARGET DEMO"…)',
    reports.some((r) => r.title.trim() === 'AIM TARGET DEMO'));
const aimBytes = new Uint8Array(fs.readFileSync(romsToCheck[0]));
const corrupted = aimBytes.slice(); corrupted[0x1000] ^= 0xFF; // flip a byte → checksum mismatch
const badReport = RC.checkRom(corrupted);
check('a corrupted image fails the computed checksum',
    !badReport.ok && badReport.items.some((i) => !i.ok && /checksum matches/.test(i.label)));
const withCopier = new Uint8Array(512 + aimBytes.length); withCopier.set(aimBytes, 512);
const copierReport = RC.checkRom(withCopier);
check('a 512-byte copier header is detected (and the header still parses)',
    copierReport.copierHeader && copierReport.title.trim() === 'AIM TARGET DEMO'
    && copierReport.items.some((i) => !i.ok && /copier/.test(i.label)));
const rcHtml = RC.renderRomCheckHtml('x.sfc', reports[0], 'csp');
check('rom-check html renders the verdict, no scripts',
    rcHtml.includes('ready for hardware') && !rcHtml.includes('<script'));
try { fs.unlinkSync(tmpRc); } catch {}

// --- G5 v1: input script parse/format (pure, luna --input semantics) ---
console.log('\n=== input script: parse / buttons / format ===');
const tmpIs = path.join(os.tmpdir(), `cooper_inputscript_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'inputScript.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpIs });
const IS = require(tmpIs);
check('hex masks parse like luna (0x-optional, sorted by frame)',
    JSON.stringify(IS.parseInputScript('300:0x1000, 120:80'))
    === JSON.stringify([{ frame: 120, mask: 0x0080 }, { frame: 300, mask: 0x1000 }]));
check('button names parse: Start, A+Right, 0 releases',
    IS.buttonsToMask('Start') === 0x1000 && IS.buttonsToMask('A+Right') === 0x0180 && IS.buttonsToMask('0') === 0);
check('unknown button throws with guidance',
    (() => { try { IS.buttonsToMask('Z'); return false; } catch (e) { return /unknown button/.test(e.message); } })());
check('missing colon throws', (() => { try { IS.parseInputScript('120'); return false; } catch { return true; } })());
check('maskToButtons round-trips', IS.maskToButtons(0x1080) === 'Start+A' && IS.maskToButtons(0) === '(released)');
check('formatInputScript emits luna-CLI canonical hex',
    IS.formatInputScript(IS.parseInputScript('120:Start,300:A+Right')) === '120:0x1000,300:0x0180');
// luna#83: a real luna-gui .input recording FILE (comment header + P1 line +
// commented P2 line) parses to exactly the P1 checkpoints.
const recFile = [
    '# luna input recording (issue #83) — player 1 frame:mask checkpoints.',
    '# Frames are absolute from power-on.',
    '#   luna state -n <instr> --input @mario_000.input "mario.sfc"',
    '10:0x0100,40:0x1080,70:0x0000',
    '# player 2 (NOT replayable via --input; use API/MCP set_joypad):',
    '# 15:0x0100',
].join('\n');
check('parseInputFile strips # comments incl. the P2 line → P1 checkpoints',
    JSON.stringify(IS.parseInputFile(recFile))
    === JSON.stringify([{ frame: 10, mask: 0x0100 }, { frame: 40, mask: 0x1080 }, { frame: 70, mask: 0x0000 }]));
check('parseInputFile round-trips to the luna-CLI canonical form',
    IS.formatInputScript(IS.parseInputFile(recFile)) === '10:0x0100,40:0x1080,70:0x0000');
check('parseInputFile on a comments-only file → empty (nothing to replay)',
    IS.parseInputFile('# just comments\n#more').length === 0);
try { fs.unlinkSync(tmpIs); } catch {}

// --- G4: memory map — WRAM ramsections + VRAM heatmap (pure, real .sym) ---
console.log('\n=== memory map: wramMap / vramHeat ===');
const tmpMm = path.join(os.tmpdir(), `cooper_memmap_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'memoryMap.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpMm });
const MM = require(tmpMm);
check('canonicalWram folds mirrors: 00:0300 == 7e:0300; 7f → +64K; ROM addr → null',
    MM.canonicalWram(0x000300) === 0x0300 && MM.canonicalWram(0x7E0300) === 0x0300
    && MM.canonicalWram(0x7F0010) === 0x10010 && MM.canonicalWram(0x00C46E) === null);
const mmap = MM.wramMap(sym); // sym = real aim_target.sym parsed earlier
check('wramMap finds ramsection blocks with exact sizes', mmap.blocks.length >= 3
    && mmap.blocks.every((b) => b.size > 0));
const oamBlock = mmap.blocks.find((b) => b.names.includes('.oam_buffer'));
check('mirror aliases merge into ONE block (.oam_buffer = .reserved_7e_mirror)',
    !!oamBlock && oamBlock.names.includes('.reserved_7e_mirror') && oamBlock.size === 0x220);
check('totals do not double-count mirrors',
    mmap.totalReserved === mmap.blocks.reduce((n, b) => n + b.size, 0));
check('labels attach to their block (oamMemory in .oam_buffer)',
    !!oamBlock && oamBlock.labels.some((l) => l.name === 'oamMemory'));
const heatT = MM.vramHeat([...new Array(1024).fill(7), ...new Array(0x10000 - 1024).fill(0)]);
check('vramHeat: first 1KB bucket full, rest empty', heatT[0] === 1024 && heatT.slice(1).every((n) => n === 0));
const mmHtml = MM.renderMemoryMapHtml(mmap, new Array(0x10000).fill(1), 'csp');
check('memory-map html: WRAM total + 64 heat cells + no scripts',
    mmHtml.includes('reserved of 128 KB') && (mmHtml.match(/class="cell"/g) || []).length === 64
    && !mmHtml.includes('<script'));
try { fs.unlinkSync(tmpMm); } catch {}

// --- G3: watch-mode source filter (the anti-rebuild-loop predicate) ---
console.log('\n=== watch mode: isWatchSource ===');
check('sources trigger: main.c, data.asm, res/hero.png, music.it, level.tmj',
    ['main.c', 'data.asm', 'res/hero.png', 'music.it', 'level.tmj'].every((f) => B.isWatchSource(f)));
check('generated artifacts NEVER trigger (rebuild-loop guard)',
    ['main.c.asm', 'main.c.o', 'crt0.wrap.asm', 'data_init_start.wrap.asm', 'game.sfc', 'game.sym',
        'linkfile', 'project_hdr.asm', 'res/hero.pic', 'res/hero.pal', 'level.map', 'soundbank.bnk', 'main.c.dbg']
        .every((f) => !B.isWatchSource(f)));
check('unrelated files ignored', !B.isWatchSource('notes.md') && !B.isWatchSource('.clangd'));

// --- G2b: CodeLens function-line extraction (pure, real main.c) ---
console.log('\n=== CodeLens: functionDefLines ===');
const tmpSb2 = path.join(os.tmpdir(), `cooper_deflines_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'sidebar.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpSb2 });
const SB2 = require(tmpSb2);
const aimC = fs.readFileSync(path.join(aimDir, 'main.c'), 'utf8');
const aimNames = new Set(SB2.extractCFunctions(aimC));
const defs = SB2.functionDefLines(aimC, aimNames);
check('functionDefLines finds every extracted function', defs.length === aimNames.size && defs.length > 2);
check('reported lines actually contain the definitions',
    defs.every(({ name, line }) => aimC.split('\n')[line] !== undefined
        && new RegExp(`\\b${name}\\s*\\(`).test(aimC.split('\n').slice(line, line + 1).join(''))));
check('filtering by names subset works',
    SB2.functionDefLines(aimC, new Set(['main'])).length === (aimNames.has('main') ? 1 : 0));
try { fs.unlinkSync(tmpSb2); } catch {}

// --- G2: interactive VRAM viewer (pure) ---
console.log('\n=== VRAM viewer: bpp/offset/sub-palette selectors ===');
const tmpVv = path.join(os.tmpdir(), `cooper_vramview_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'vramView.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpVv });
const VV = require(tmpVv);
check('subpalCount: 2bpp=64, 4bpp=16, 8bpp=1',
    VV.subpalCount(2) === 64 && VV.subpalCount(4) === 16 && VV.subpalCount(8) === 1);
const vv_vram = new Array(0x10000).fill(0).map((_, i) => i & 0xFF);
const vv_cgram = new Array(256).fill(0).map((_, i) => i);
const vv1 = VV.renderVramViewHtml(vv_vram, vv_cgram, { bpp: 4, offset: 0, subpal: 0 }, 'csp', 'N1');
check('vram view renders the toolbar (bpp/offset/subpal/refresh)',
    ['id="bpp"', 'id="offset"', 'id="subpal"', 'id="refresh"'].every((s) => vv1.includes(s)));
check('vram view embeds a PNG and a nonce-gated script',
    vv1.includes('data:image/png;base64,') && vv1.includes('nonce="N1"'));
check('vram view info line: 512 tiles at 4bpp', vv1.includes('512 tiles') && vv1.includes('$0000'));
const vv2 = VV.renderVramViewHtml(vv_vram, vv_cgram, { bpp: 2, offset: 0x2000, subpal: 63 }, 'csp', 'N1');
check('2bpp window: 1024 tiles, offset marked selected', vv2.includes('1024 tiles')
    && vv2.includes('value="8192" selected'));
check('sub-palette clamped to the bpp group count', vv2.includes('sub-palette 63/63'));
const vv3 = VV.renderVramViewHtml(vv_vram, vv_cgram, { bpp: 8, offset: 0, subpal: 5 }, 'csp', 'N1');
check('8bpp: single sub-palette (clamped 0/0), 256 tiles', vv3.includes('sub-palette 0/0') && vv3.includes('256 tiles'));
check('different offsets render different sheets',
    VV.renderVramViewHtml(vv_vram, vv_cgram, { bpp: 4, offset: 0, subpal: 0 }, 'csp', 'N')
    !== VV.renderVramViewHtml(vv_vram, vv_cgram, { bpp: 4, offset: 0x4000, subpal: 0 }, 'csp', 'N'));
try { fs.unlinkSync(tmpVv); } catch {}

// --- G1: luna-gui resolution (pure, synthetic layouts) ---
console.log('\n=== luna-gui resolution ===');
const guiRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cooper_gui_'));
try {
    // release-zip layout: luna + luna-gui side by side in a folder
    fs.writeFileSync(path.join(guiRoot, 'luna'), '#!/bin/sh\n');
    fs.writeFileSync(path.join(guiRoot, 'luna-gui'), '#!/bin/sh\n');
    check('luna-gui found inside a configured folder',
        B.resolveLunaGuiPath({ configured: guiRoot }) === path.join(guiRoot, 'luna-gui'));
    check('luna-gui found as a sibling of a configured luna BINARY',
        B.resolveLunaGuiPath({ configured: path.join(guiRoot, 'luna') }) === path.join(guiRoot, 'luna-gui'));
    fs.unlinkSync(path.join(guiRoot, 'luna-gui'));
    check('no luna-gui → null (SDK pinned harness ships only the CLI)',
        B.resolveLunaGuiPath({ configured: guiRoot, sdkPath: OPENSNES }) === null
        || fs.existsSync(path.join(OPENSNES, 'tools', 'luna-test', 'bin', 'luna-gui')));
} finally {
    try { fs.rmSync(guiRoot, { recursive: true, force: true }); } catch {}
}

// --- onboarding helpers (pure + against the real SDK) ---
console.log('\n=== onboarding: arch mapping + debug-info detection ===');
const tmpOb = path.join(os.tmpdir(), `cooper_onboarding_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'onboarding.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpOb });
const OB = require(tmpOb);
check('releaseArchTag linux/arm64', OB.releaseArchTag('linux', 'arm64') === 'linux_arm64');
check('releaseArchTag win32/x64 → windows_x86_64', OB.releaseArchTag('win32', 'x64') === 'windows_x86_64');
check('releaseArchTag darwin/x64 has no prebuilt (null)', OB.releaseArchTag('darwin', 'x64') === null);
check('releaseArchTag unknown platform is null', OB.releaseArchTag('freebsd', 'x64') === null);
const devCc = path.join(OPENSNES, 'compiler', 'scripts', 'cc65816');
if (fs.existsSync(devCc)) {
    check('dev-tree cc65816 carries the debug-info gate',
        OB.sdkSupportsDebugInfo(fs.readFileSync(devCc, 'utf8')) === true);
}
check('a pre-0.26 wrapper (no CC65816_G) is detected as unsupported',
    OB.sdkSupportsDebugInfo('#!/bin/bash\ncproc "$@"') === false);
try { fs.unlinkSync(tmpOb); } catch {}
check('dashboard escapes the project name (no HTML injection)',
    D2.renderDashboardHtml({ hasProject: true, projectName: '<img>', romBuilt: false, sdkName: null, lunaFound: false }, 'csp', 'N').includes('&lt;img&gt;'));
try { fs.unlinkSync(tmpD2); } catch {}

// --- PPU decode + palette viewer rendering (pure) ---
console.log('\n=== PPU/palette decode (pure) ===');
const tmpP = path.join(os.tmpdir(), `cooper_ppu_${process.pid}.cjs`);
esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'ppu.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: tmpP,
});
const P = require(tmpP);
check('bgr555 white (0x7FFF) -> #ffffff', P.rgbHex(P.bgr555ToRgb(0x7FFF)) === '#ffffff');
check('bgr555 black (0) -> #000000', P.rgbHex(P.bgr555ToRgb(0)) === '#000000');
check('bgr555 red is the low 5 bits (0x001F)', P.rgbHex(P.bgr555ToRgb(0x001F)) === '#ff0000');
check('bgr555 blue is the high 5 bits (0x7C00)', P.rgbHex(P.bgr555ToRgb(0x7C00)) === '#0000ff');
check('decodeCgram maps 256 words', P.decodeCgram(new Array(256).fill(0)).length === 256);
const palHtml = P.renderPaletteHtml(P.decodeCgram([0x7FFF, ...new Array(255).fill(0)]), 'vscode-csp:src');
check('palette html has 256 swatches', (palHtml.match(/class="sw"/g) || []).length === 256);
check('palette html embeds the cspSource', palHtml.includes('vscode-csp:src'));
check('palette html shows the white swatch', palHtml.includes('background:#ffffff'));

// OAM decode (synthetic, value-exact) + render
const oamArr = new Array(544).fill(0);
oamArr[0] = 124; oamArr[1] = 107; oamArr[2] = 5; oamArr[3] = 0x0E; // sprite0: pal=7
oamArr[5] = 240;                                                   // sprite1: hidden
oamArr[512] = 0x02;                                                // sprite0 high bits: size=1
const sprites = P.decodeOam(oamArr);
check('decodeOam returns 128 sprites', sprites.length === 128);
check('decodeOam sprite0 X/Y/tile', sprites[0].x === 124 && sprites[0].y === 107 && sprites[0].tile === 5);
check('decodeOam sprite0 palette/size', sprites[0].palette === 7 && sprites[0].sizeLarge === true);
check('decodeOam sprite0 onScreen, sprite1 hidden', sprites[0].onScreen === true && sprites[1].onScreen === false);
const oamHtml = P.renderOamHtml(sprites, 'vscode-csp:src');
check('oam html reports 128 sprites', oamHtml.includes('128 sprites'));
check('oam html embeds cspSource', oamHtml.includes('vscode-csp:src'));
try { fs.unlinkSync(tmpP); } catch {}

// --- VRAM tile decode + PNG encode (pure) ---
console.log('\n=== VRAM tile decode + PNG (pure) ===');
const tmpT = path.join(os.tmpdir(), `cooper_tiles_${process.pid}.cjs`);
esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'tiles.ts')],
    bundle: true, platform: 'node', format: 'cjs', outfile: tmpT,
});
const T = require(tmpT);
// 4bpp: one bit set in each plane at a distinct column -> indices 1,2,4,8
const t4 = new Array(32).fill(0);
t4[0] = 0x80; t4[1] = 0x40; t4[16] = 0x20; t4[17] = 0x10;
const px4 = T.decodeTile(t4, 0, 4);
check('decodeTile 4bpp plane bits -> 1,2,4,8', px4[0] === 1 && px4[1] === 2 && px4[2] === 4 && px4[3] === 8);
// 2bpp: both planes set col0 -> index 3
const t2 = new Array(16).fill(0); t2[0] = 0x80; t2[1] = 0x80;
check('decodeTile 2bpp both planes -> 3', T.decodeTile(t2, 0, 2)[0] === 3);
check('decodeTileSheet count', T.decodeTileSheet(new Array(64).fill(0), 4, 2).length === 2);
const pal16 = new Array(16).fill(0).map((_, i) => ({ r: i, g: i, b: i }));
const rgba = T.tilesToRgba(T.decodeTileSheet(new Array(32 * 32).fill(0), 4, 32), pal16, 16);
check('tilesToRgba 32 tiles, 16/row -> 128x16', rgba.width === 128 && rgba.height === 16);
const png = T.encodePng(8, 8, new Uint8Array(8 * 8 * 4));
check('encodePng has PNG signature', png[0] === 0x89 && png.slice(1, 4).toString('ascii') === 'PNG');
check('encodePng IHDR width = 8', png.readUInt32BE(16) === 8);
check('renderVramHtml embeds a PNG data URI', T.renderVramHtml('AAAA', 'vscode-csp:src', 'x').includes('data:image/png;base64,AAAA'));
try { fs.unlinkSync(tmpT); } catch {}

// ===========================================================================
// C6 — SNES palette editor: pngPalette (pure), against a real indexed PNG.
// ===========================================================================
console.log('\n=== SNES palette editor: pngPalette (pure) ===');
const tmpPP = path.join(os.tmpdir(), `cooper_pp_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'pngPalette.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpPP });
const PP = require(tmpPP);
// BGR555 ↔ RGB8 (the gfx4snes convention: >>3, and (v<<3)|(v>>2) back)
check('rgb8ToBgr555 packs (b<<10)|(g<<5)|r, 5-bit', PP.rgb8ToBgr555({ r: 255, g: 0, b: 255 }) === 0x7C1F);
check('bgr555->rgb8->bgr555 round-trips', PP.rgb8ToBgr555(PP.bgr555ToRgb8(0x7C1F)) === 0x7C1F && PP.rgb8ToBgr555(PP.bgr555ToRgb8(0x0421)) === 0x0421);
check('snapToBgr555 quantises to the SNES 5-bit grid', PP.rgb8ToBgr555(PP.snapToBgr555({ r: 250, g: 3, b: 131 })) === PP.rgb8ToBgr555({ r: 250, g: 3, b: 131 }));
const pngPath = path.join(OPENSNES, 'examples', 'maps', 'slopemario', 'res', 'mario_sprite.png');
if (fs.existsSync(pngPath)) {
    const pbuf = fs.readFileSync(pngPath);
    const png = PP.readIndexedPng(pbuf);
    check('reads an indexed PNG palette (colorType 3)', png.colorType === 3 && png.palette.length > 0);
    // matches gfx4snes exactly, when the .pal artifact is present
    const palPath = pngPath.replace(/\.png$/, '.pal');
    if (fs.existsSync(palPath)) {
        const palBlob = fs.readFileSync(palPath);
        let exact = true;
        for (let i = 0; i < Math.min(16, palBlob.length / 2); i++) {
            if (palBlob.readUInt16LE(i * 2) !== PP.rgb8ToBgr555(png.palette[i])) { exact = false; }
        }
        check('PNG palette >>3 == gfx4snes .pal (BGR555, exact)', exact);
    }
    // writePalette: edit one entry, re-read, others + pixels intact, same file size
    const edited = PP.writePalette(pbuf, png.palette.map((c, i) => (i === 1 ? { r: 8, g: 16, b: 24 } : c)));
    const png2 = PP.readIndexedPng(edited);
    check('writePalette keeps entry count', png2.palette.length === png.palette.length);
    check('writePalette edits the target entry', png2.palette[1].r === 8 && png2.palette[1].g === 16 && png2.palette[1].b === 24);
    check('writePalette leaves other entries intact', png2.palette[0].r === png.palette[0].r && png2.palette[2].b === png.palette[2].b);
    check('writePalette is in-place (PLTE only, pixels untouched)', edited.length === pbuf.length);
    // decode pixels for the live preview
    const px = PP.readIndexedPixels(pbuf);
    check('readIndexedPixels decodes width*height indices', px.indices.length === png.width * png.height);
    check('every pixel index is within the palette', Array.from(px.indices).every((i) => i < png.palette.length));
    // writeIndexedPixels: paint one pixel, re-encode, round-trip + palette kept
    const painted = Array.from(px.indices);
    painted[0] = painted[0] === 3 ? 2 : 3;
    const rw = PP.writeIndexedPixels(pbuf, painted);
    const px2 = PP.readIndexedPixels(rw);
    check('writeIndexedPixels round-trips the pixels', px2.indices.length === painted.length && Array.from(px2.indices).every((v, i) => v === painted[i]));
    check('writeIndexedPixels preserves the palette', PP.readIndexedPng(rw).palette.length === png.palette.length);
} else {
    skipped('no SDK sprite PNG found');
}
try { fs.unlinkSync(tmpPP); } catch {}

// palette editor webview (pure HTML render)
const tmpPE = path.join(os.tmpdir(), `cooper_pe_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'paletteEditor.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpPE });
const PE = require(tmpPE);
const peHtml = PE.renderPaletteEditorHtml([{ r: 255, g: 0, b: 255 }, { r: 0, g: 0, b: 0 }], 'vscode-csp:x', 'NONCE123', { fileName: 'sprite.png', pixels: { width: 2, height: 1, indices: [0, 1] } });
check('palette editor gates its script by nonce (CSP)', peHtml.includes('nonce-NONCE123') && peHtml.includes('nonce="NONCE123"'));
check('palette editor names BGR555 + the file', peHtml.includes('BGR555') && peHtml.includes('sprite.png'));
check('palette editor embeds the palette as BGR555 words', peHtml.includes(JSON.stringify([0x7C1F, 0])));
check('palette editor has a Save-to-PNG action', /id="save"/.test(peHtml));
check('palette editor has a bpp (sub-palette size) selector', /id="bpp"/.test(peHtml));
check('palette editor embeds pixels for the live preview canvas', /id="spr"/.test(peHtml) && peHtml.includes('"indices":[0,1]'));
try { fs.unlinkSync(tmpPE); } catch {}

// tile/sprite editor webview (pure HTML render)
const tmpTE = path.join(os.tmpdir(), `cooper_te_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'tileEditor.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpTE });
const TE = require(tmpTE);
check('SPRITE_CELLS are the SNES square sizes (×8)', JSON.stringify(TE.SPRITE_CELLS) === '[8,16,32,64]');
const teHtml = TE.renderTileEditorHtml({ width: 2, height: 2, indices: [0, 1, 2, 3] }, [{ r: 0, g: 0, b: 0 }, { r: 255, g: 0, b: 0 }], 'vscode-csp:x', 'TN123', { fileName: 'tiles.png' });
check('tile editor gates its script by nonce (CSP)', teHtml.includes('nonce-TN123') && teHtml.includes('nonce="TN123"'));
check('tile editor embeds the pixel indices', teHtml.includes('"indices":[0,1,2,3]') && teHtml.includes('tiles.png'));
check('tile editor has a cell-size overlay + Save', /id="cell"/.test(teHtml) && /id="save"/.test(teHtml));
check('tile editor has the animation preview (G8a: from/frames/fps/play/canvas)',
    ['id="afrom"', 'id="acount"', 'id="afps"', 'id="aplay"', 'id="apreview"'].every((s) => teHtml.includes(s))
    && teHtml.includes('drawAnimFrame'));
check('tile editor has undo/redo (history)', /id="undo"/.test(teHtml) && /id="redo"/.test(teHtml) && /keydown/.test(teHtml));
try { fs.unlinkSync(tmpTE); } catch {}

// tilemap viewer: parse 16-bit entries + assemble with sub-palette + flip
const tmpTM = path.join(os.tmpdir(), `cooper_tm_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'tilemap.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpTM });
const TM = require(tmpTM);
const ents = TM.parseTilemapEntries([0x01, 0x00, 0x02, 0x84]); // 0x0001, 0x8402
check('parseTilemapEntries: tile/palette/flip bits (vhopppcc cccccccc)',
    ents.length === 2 && ents[0].tile === 1 && ents[0].pal === 0 && ents[0].vflip === 0
    && ents[1].tile === 2 && ents[1].pal === 1 && ents[1].vflip === 1);
const oneTile = new Array(64).fill(0); oneTile[0] = 1; // only the top-left pixel is index 1
const pal2 = [{ r: 0, g: 0, b: 0 }, { r: 255, g: 0, b: 0 }];
const asm = TM.assembleTilemapRgba([{ tile: 0, pal: 0, prio: 0, hflip: 0, vflip: 0 }], [oneTile], pal2, 1);
check('assembleTilemapRgba: paints index via sub-palette', asm.width === 8 && asm.height === 8 && asm.data[0] === 255 && asm.data[3] === 255);
check('assembleTilemapRgba: index 0 is transparent', asm.data[(1 * 8 + 1) * 4 + 3] === 0);
const asmF = TM.assembleTilemapRgba([{ tile: 0, pal: 0, prio: 0, hflip: 1, vflip: 0 }], [oneTile], pal2, 1);
check('assembleTilemapRgba: applies H-flip', asmF.data[(0 * 8 + 7) * 4] === 255 && asmF.data[(0 * 8 + 7) * 4 + 3] === 255 && asmF.data[3] === 0);
try { fs.unlinkSync(tmpTM); } catch {}

// AI context (C7 part 1): AGENTS.md carries the OpenSNES/SNES rules
const tmpAI = path.join(os.tmpdir(), `cooper_ai_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'aiContext.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpAI });
const AI = require(tmpAI);
const md = AI.renderAgentsMd({ projectName: 'shmup', romName: 'shmup.sfc' });
check('AGENTS.md warns int is 2 bytes (cc65816)', md.includes('is 2 bytes'));
check('AGENTS.md recommends fixed-width types', md.includes('u8/u16/u32'));
check('AGENTS.md documents BGR555 + CGRAM layout', md.includes('BGR555') && md.includes('sprites'));
check('AGENTS.md documents sprite sizes (OBSEL) + assets (gfx4snes)', md.includes('OBSEL') && md.includes('gfx4snes'));
check('AGENTS.md points at luna for verification', md.includes('luna'));
check('AGENTS.md names the project', md.includes('shmup'));
const ci = AI.renderCopilotInstructions();
check('copilot-instructions points at AGENTS.md + int caveat', ci.includes('AGENTS.md') && ci.includes('2 bytes'));
try { fs.unlinkSync(tmpAI); } catch {}

// MCP config (C7 part 2): register luna for the AI, per-assistant keys
const tmpMC = path.join(os.tmpdir(), `cooper_mc_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'mcpConfig.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpMC });
const MC = require(tmpMC);
const vc = JSON.parse(MC.mergeVscodeMcp(null, '/bin/luna'));
check('mergeVscodeMcp: key "servers" + luna stdio (VS Code/Copilot)', vc.servers.luna.type === 'stdio' && vc.servers.luna.command === '/bin/luna' && JSON.stringify(vc.servers.luna.args) === '["mcp"]');
const vcM = JSON.parse(MC.mergeVscodeMcp('{"servers":{"other":{"type":"http","url":"x"}}}', '/bin/luna'));
check('mergeVscodeMcp: preserves existing servers', !!vcM.servers.other && !!vcM.servers.luna);
const pc = JSON.parse(MC.mergeProjectMcp(null, '/bin/luna'));
check('mergeProjectMcp: key "mcpServers" (Claude Code / Cursor)', pc.mcpServers.luna.command === '/bin/luna' && JSON.stringify(pc.mcpServers.luna.args) === '["mcp"]');
try { fs.unlinkSync(tmpMC); } catch {}

// OpenSNES MCP (C7 part 3): SDK querying + the server dispatch, vs the real SDK
console.log('\n=== OpenSNES MCP (SDK query + server) ===');
const tmpOA = path.join(os.tmpdir(), `cooper_oa_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'opensnesApi.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpOA });
const OA = require(tmpOA);
check('listHeaders finds the SDK snes/*.h', OA.listHeaders(OPENSNES).some((h) => h.name === 'snes.h') && OA.listHeaders(OPENSNES).length > 10);
const oam = OA.lookupApi(OPENSNES, 'oamSet');
check('lookupApi finds oamSet signature in sprite.h', !!oam && /oamSet/.test(oam.signature) && oam.header.includes('sprite.h'));
check('lookupApi finds a macro (OBJ_SIZE8_L32)', (() => { const m = OA.lookupApi(OPENSNES, 'OBJ_SIZE8_L32'); return !!m && /define\s+OBJ_SIZE8_L32/.test(m.signature); })());
check('searchApi matches symbols by substring', OA.searchApi(OPENSNES, 'oam').some((x) => x.symbol === 'oamInit'));
check('hardwareConstraint(compiler) says int is 2 bytes', OA.hardwareConstraint('compiler').includes('2 bytes'));
try { fs.unlinkSync(tmpOA); } catch {}

const tmpOM = path.join(os.tmpdir(), `cooper_om_${process.pid}.cjs`);
esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'opensnesMcp.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpOM });
const OM = require(tmpOM);
check('MCP initialize returns serverInfo', OM.handleMessage(OPENSNES, { id: 1, method: 'initialize', params: {} }).result.serverInfo.name === 'opensnes');
check('MCP notifications/initialized has no reply', OM.handleMessage(OPENSNES, { method: 'notifications/initialized' }) === null);
check('MCP tools/list lists the 4 tools', OM.handleMessage(OPENSNES, { id: 2, method: 'tools/list' }).result.tools.length === 4);
const mcall = OM.handleMessage(OPENSNES, { id: 3, method: 'tools/call', params: { name: 'lookup_api', arguments: { symbol: 'oamSet' } } });
check('MCP tools/call lookup_api returns the signature', /oamSet/.test(mcall.result.content[0].text));
check('MCP unknown method -> JSON-RPC error', !!OM.handleMessage(OPENSNES, { id: 4, method: 'bogus' }).error);
try { fs.unlinkSync(tmpOM); } catch {}

// ===========================================================================
// P2.1a — the hand-rolled luna MCP client, end-to-end against the real binary.
// ===========================================================================
(async () => {
    console.log('\n=== luna MCP client: end-to-end debug loop ===');
    const tmpM = path.join(os.tmpdir(), `cooper_lunamcp_${process.pid}.cjs`);
    esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', 'src', 'lunaMcp.ts')],
        bundle: true, platform: 'node', format: 'cjs', outfile: tmpM,
    });
    const { LunaMcp } = require(tmpM);
    const lunaBin = B.resolveLunaPath({ sdkPath: OPENSNES });
    if (!lunaBin || !fs.existsSync(lunaBin)) {
        skipped('luna binary not available');
    } else {
        if (!fs.existsSync(ri.rom)) { cp.spawnSync('make', [], { cwd: aimDir }); }
        const m = new LunaMcp({ timeoutMs: 30000 });
        try {
            await m.connect(lunaBin, aimDir);
            check('connected; serverInfo.name present', !!m.serverInfo.name);
            await m.loadRom(ri.rom);
            const cpu0 = await m.cpu();
            check('state.cpu has a numeric pc', typeof cpu0.pc === 'number');
            // the de-risk hit: a write to INIDISP $2100 stops in InitHardware (0x836B)
            const w = await m.runUntilMemWrite(0x002100, 300000);
            check('run_until_mem_write($2100) hit', w.hit === true);
            check('  reported pc === 0x836B', w.pc === 0x836B);
            // resolve that PC through the .sym — closes parser + client together
            const r = S.addrToSymbol(sym, w.pc);
            check('  hit PC resolves to InitHardware via .sym', !!r && r.name === 'InitHardware');
            // single-step, then run_until_pc to where we are returns immediately
            await m.step(1);
            const cpuB = await m.cpu();
            check('step{1} keeps a numeric pc', typeof cpuB.pc === 'number');
            const target = (cpuB.pb << 16) | cpuB.pc;
            const hit = await m.runUntilPc(target, 50);
            check('run_until_pc(current) hit', hit.hit === true);

            // --- D-045: native multi-breakpoint continue (bp registry, luna ≥1.6) ---
            const initAddr = S.symbolToAddr(sym, 'InitHardware');
            const mainAddr = S.symbolToAddr(sym, 'main');
            check('symbols for the 2-bp test resolve', initAddr !== undefined && mainAddr !== undefined);
            await m.reset();
            await m.bpClearAll();
            const b1 = await m.bpAdd({ kind: 'exec', addr: initAddr });
            const b2 = await m.bpAdd({ kind: 'exec', addr: mainAddr });
            check('bp_add returns distinct ids', b1.id !== b2.id);
            const list = await m.bpList();
            check('bp_list shows both exec breakpoints', list.breakpoints.length === 2
                && list.breakpoints.every((b) => b.kind === 'exec'));
            const h1 = await m.runUntilBreak(5000000);
            check('run_until_break hits one of the two BPs',
                h1.hit === true && (h1.pc === initAddr || h1.pc === mainAddr));
            const h2 = await m.runUntilBreak(5000000);
            check('second continue hits the OTHER breakpoint (multi-bp in one run)',
                h2.hit === true && h2.pc !== h1.pc && (h2.pc === initAddr || h2.pc === mainAddr));
            // mixed kind: a write watchpoint over INIDISP $2100 alongside exec BPs
            await m.bpClearAll();
            await m.bpAdd({ kind: 'mem', addr: 0x002100, onWrite: true });
            await m.reset();
            const h3 = await m.runUntilBreak(5000000);
            check('watchpoint via registry fires with pc/addr/value',
                h3.hit === true && h3.kind === 'write' && h3.addr === 0x002100
                && typeof h3.pc === 'number' && typeof h3.value === 'number');
            await m.bpClearAll();

            // --- D-046: save/load state round-trip (luna ≥1.6 savestates) ---
            const snapCpu = await m.cpu();
            const snap = await m.saveState();
            check('save_state returns a base64 blob with a size', snap.state_base64.length > 0 && snap.bytes > 0);
            await m.step(5000); // drift away from the snapshot
            const drifted = await m.cpu();
            await m.loadState(snap.state_base64);
            const restored = await m.cpu();
            const tuple = (c) => [c.pc, c.pb, c.a, c.x, c.y, c.sp].join(',');
            check('load_state restores the exact CPU state',
                tuple(restored) === tuple(snapCpu) && tuple(drifted) !== tuple(snapCpu));

            // --- D-047: symbol-annotated disassembly at the live PC ---
            const symPath = ri.rom.replace(/\.(sfc|smc)$/i, '.sym');
            const ls = await m.loadSymbols(symPath);
            check('load_symbols ingests the .sym into luna', ls.count > 0);
            const dis = await m.disasmCpu({ lines: 8 });
            check('disasm_cpu returns the requested lines', dis.lines.length === 8);
            check('disasm marks the live PC on the first line',
                dis.lines[0].is_pc === true && dis.lines.filter((l) => l.is_pc).length === 1);
            check('disasm lines carry text + bytes',
                dis.lines.every((l) => typeof l.text === 'string' && l.text.length > 0 && Array.isArray(l.bytes)));
            check('disasm is symbol-annotated after load_symbols',
                dis.lines.some((l) => typeof l.symbol === 'string' && l.symbol.length > 0));

            // --- G5: replay mechanics — set_joypad lands in JOY1 after auto-read ---
            // NOTE: peek_memory reads the $2000-$5FFF register band as 0 by design
            // (side-effect-free debug view) — the latched pad is state.cpu_regs.joy1.
            await m.reset();
            for (let f = 0; f < 5; f++) { await m.stepUntilFrame(2000000); } // init + NMI/auto-read on
            await m.setJoypad(0, 0x1080); // Start+A
            await m.stepUntilFrame(2000000);
            const regs = (await m.state()).cpu_regs || {};
            check('set_joypad mask latched by the auto-read (state.cpu_regs.joy1 = Start+A)',
                regs.joy1 === 0x1080);
            check('frameCount tracks the scheduler', (await m.frameCount()) >= 6);

            // --- G7: one traced frame profiles with symbol attribution ---
            await m.enableCpuTrace(200000);
            await m.stepUntilFrame(2000000);
            const cpuTrace = await m.takeCpuTrace();
            check('cpu trace captures a full frame of instructions', cpuTrace.events.length > 1000);
            check('trace events are symbol-annotated (load_symbols ran)',
                cpuTrace.events.filter((e) => e.symbol).length > cpuTrace.events.length / 2);
            const PF2 = require(path.join(os.tmpdir(), `cooper_profiler_${process.pid}.cjs`));
            const realProf = PF2.aggregateProfile(cpuTrace.events);
            check('real frame aggregates into named functions with sane totals',
                realProf.rows.length > 3 && realProf.rows[0].cycles > 0
                && realProf.totalCycles > 100000 && realProf.totalCycles < 800000);

            // --- G2: full 64 KB VRAM via two u16-capped reads ---
            const vlo = await m.peekVram(0, 0x8000);
            const vhi = await m.peekVram(0x8000, 0x8000);
            check('full VRAM = two 32 KB peeks (u16 count cap workaround)',
                vlo.length === 0x8000 && vhi.length === 0x8000);

            // --- D-048: mem trace over one frame ("who writes $2100?") ---
            await m.reset();
            await m.stepUntilFrame(2000000); // frame 1 ends before InitHardware's writes
            await m.enableMemTrace({ maxEvents: 1024, bank: 0x00, lo: 0x2100, hi: 0x2100 });
            await m.stepUntilFrame(2000000); // frame 2 carries the INIDISP writes
            const trace = await m.takeMemTrace();
            // luna interleaves nmi/irq context markers — the adapter filters to bus accesses
            const rw = trace.events.filter((ev) => ev.kind === 'read' || ev.kind === 'write');
            check('mem trace records the INIDISP writes (filtered to the address)',
                rw.length > 0 && rw.every((ev) => (ev.addr & 0xFFFF) === 0x2100 && ev.kind === 'write'));
            check('mem trace events carry pc/value/scanline',
                rw.every((ev) => typeof ev.pc === 'number' && typeof ev.value === 'number' && typeof ev.line === 'number'));
            check('mem trace attributes a write to InitHardware',
                rw.some((ev) => (S.addrToSymbol(sym, ev.pc) || {}).name === 'InitHardware'));
        } catch (e) {
            check('MCP end-to-end threw: ' + String((e && e.message) || e), false);
        } finally {
            m.dispose();
        }
    }
    try { fs.unlinkSync(tmpM); } catch {}

    // --- G9 (opensnes#98): gameplay tests via the SDK `make test` harness ---
    console.log('\n=== gameplay tests: manifest + make test ===');
    const tmpMt2 = path.join(os.tmpdir(), `cooper_manifesttest_${process.pid}.cjs`);
    esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'manifestTest.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpMt2 });
    const MT2 = require(tmpMt2);
    // pure: upsert idempotence + output parsing
    let man = MT2.upsertManifestTest('', { name: 'boot', steps: 3000000 });
    man = MT2.upsertManifestTest(man, { name: 'walk', steps: 3000000, input: '10:0x0100,200:0x0000', asserts: ['target_x = F700'] });
    check('manifest upsert: 2 named blocks', MT2.manifestTestNames(man).join(',') === 'boot,walk');
    check('manifest upsert: input + assert rendered', man.includes('input = "10:0x0100,200:0x0000"') && man.includes('assert = ["target_x = F700"]'));
    const man2 = MT2.upsertManifestTest(man, { name: 'walk', steps: 3000000, input: '10:0x0100,200:0x0000', asserts: ['target_x = C800'] });
    check('manifest upsert replaces, never duplicates', MT2.manifestTestNames(man2).join(',') === 'boot,walk' && man2.includes('C800') && !man2.includes('F700'));
    check('formatAssert little-endian', MT2.formatAssert('target_x', [0x86, 0x00]) === 'target_x = 8600');
    check('parseMakeTestOutput reads PASS/FAIL lines',
        (() => { const r = MT2.parseMakeTestOutput('  PASS  boot\n  FAIL  walk: bad\nTESTS: 1/2 ok'); return r.length === 2 && r[0].pass && !r[1].pass && r[1].detail === 'bad'; })());

    // real: scaffold an out-of-tree project on the SDK harness, make test-update → make test
    const harness = path.join(OPENSNES, 'tools', 'luna-test', 'project_test.py');
    const lunaBinH = B.resolveLunaPath({ sdkPath: OPENSNES });
    if (!fs.existsSync(harness) || !lunaBinH) {
        skipped('SDK make-test harness or luna not available');
    } else {
        const tmpNp2 = path.join(os.tmpdir(), `cooper_np2_${process.pid}.cjs`);
        esbuild.buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'newProject.ts')], bundle: true, platform: 'node', format: 'cjs', outfile: tmpNp2 });
        const NP2 = require(tmpNp2);
        const proj = path.join(os.tmpdir(), `cooper_mt_${process.pid}`, 'game');
        try {
            NP2.scaffoldProject(aimDir, proj, 'game', OPENSNES);
            cp.spawnSync('make', [], { cwd: proj, timeout: 180000 });
            fs.mkdirSync(path.join(proj, 'test'), { recursive: true });
            // a boot visual test + an input test asserting the clamped target_x
            let m = MT2.upsertManifestTest('', { name: 'boot', steps: 3000000 });
            m = MT2.upsertManifestTest(m, { name: 'walk_right', steps: 3000000, input: '10:0x0100,200:0x0000', asserts: ['target_x = F700'] });
            fs.writeFileSync(path.join(proj, 'test', 'manifest.toml'), m);
            const up = cp.spawnSync('make', ['test-update'], { cwd: proj, encoding: 'utf8', timeout: 180000 });
            check('make test-update writes baselines', up.status === 0 && fs.existsSync(path.join(proj, 'test', 'baselines.json')));
            const run1 = cp.spawnSync('make', ['test'], { cwd: proj, encoding: 'utf8', timeout: 180000 });
            const res1 = MT2.parseMakeTestOutput(run1.stdout || '');
            check('make test: both tests PASS on the fresh baseline',
                run1.status === 0 && res1.length === 2 && res1.every((r) => r.pass));
            // inject a real regression: the right bound never reaches 247
            const mainC = path.join(proj, 'main.c');
            fs.writeFileSync(mainC, fs.readFileSync(mainC, 'utf8').replace('target_x < 247', 'target_x < 200'));
            cp.spawnSync('make', [], { cwd: proj, timeout: 180000 });
            const run2 = cp.spawnSync('make', ['test'], { cwd: proj, encoding: 'utf8', timeout: 180000 });
            const res2 = MT2.parseMakeTestOutput(run2.stdout || '');
            check('make test: the injected regression FAILS walk_right, boot stays green',
                run2.status !== 0 && res2.find((r) => r.name === 'walk_right' && !r.pass) && res2.find((r) => r.name === 'boot' && r.pass));
        } catch (e) {
            check('make-test e2e threw: ' + String((e && e.message) || e), false);
        } finally {
            try { fs.rmSync(path.dirname(proj), { recursive: true, force: true }); } catch {}
        }
    }
    try { fs.unlinkSync(tmpMt2); } catch {}

    // --- G10 v1: hear the game — real music example renders non-silent audio ---
    console.log('\n=== audition: real snesmod_music audio ===');
    const musicDir = path.join(OPENSNES, 'examples', 'audio', 'snesmod_music');
    const lunaBinA = B.resolveLunaPath({ sdkPath: OPENSNES });
    if (!lunaBinA || !fs.existsSync(musicDir)) {
        skipped('luna or the snesmod_music example not available');
    } else {
        let musicRom = (fs.readdirSync(musicDir).find((f) => f.endsWith('.sfc')));
        if (!musicRom) {
            cp.spawnSync('make', [], { cwd: musicDir, timeout: 180000 });
            musicRom = fs.readdirSync(musicDir).find((f) => f.endsWith('.sfc'));
        }
        if (!musicRom) {
            skipped('snesmod_music did not build');
        } else {
            const WV2 = require(path.join(os.tmpdir(), `cooper_wav_${process.pid}.cjs`));
            const mA = new LunaMcp({ timeoutMs: 30000 });
            try {
                await mA.connect(lunaBinA, musicDir);
                await mA.loadRom(path.join(musicDir, musicRom));
                const out = [];
                for (let f = 0; f < 120; f++) { // 2 seconds
                    await mA.stepUntilFrame(2000000);
                    out.push(...await mA.drainAudio(4096));
                }
                check('two seconds of audio drained (~128k samples)', out.length > 60000);
                const ratio = WV2.nonSilentRatio(out);
                check('the music example actually makes sound (>10% non-silent)', ratio > 0.10);
                const wavBuf = WV2.encodeWav(out);
                check('the capture encodes to a playable wav', wavBuf.length === 44 + out.length * 2);
            } catch (e) {
                check('audition e2e threw: ' + String((e && e.message) || e), false);
            } finally {
                mA.dispose();
            }
        }
    }

    // =======================================================================
    // P2.1b — the DAP session, driven headlessly end-to-end (real binary).
    // =======================================================================
    console.log('\n=== DAP session: debug loop (registers, symbol breakpoint) ===');
    const tmpD = path.join(os.tmpdir(), `cooper_lunadebug_${process.pid}.cjs`);
    esbuild.buildSync({
        entryPoints: [path.join(__dirname, '..', 'src', 'lunaDebug.ts')],
        bundle: true, platform: 'node', format: 'cjs', outfile: tmpD,
        external: ['vscode'],
    });
    const D = require(tmpD);

    // pure unit tests (no binary):
    check('decodeP(0x30) -> nvMXdizc', D.decodeP(0x30) === 'nvMXdizc');
    const regs = D.formatRegisters({ a: 0x1234, x: 1, y: 2, sp: 0x01FF, pc: 0x8365, pb: 0, db: 0, dp: 0, p: 0x30, e: 1 });
    check('formatRegisters PC = $00:8365', regs.find((r) => r.name === 'PC').value === '$00:8365');
    check('formatRegisters A = $1234', regs.find((r) => r.name === 'A').value === '$1234');
    check('formatRegisters P decodes flags', regs.find((r) => r.name === 'P').value === '$30 (nvMXdizc)');
    check('formatRegisters PC carries memoryReference', regs.find((r) => r.name === 'PC').memoryReference === '0x008365');
    check('formatRegisters P has no memoryReference', regs.find((r) => r.name === 'P').memoryReference === undefined);

    // Source-level stepping decisions (pure): call lengths + the stop predicate.
    check('callLen JSR ($20) = 3', D.callLen(0x20) === 3);
    check('callLen JSL ($22) = 4', D.callLen(0x22) === 4);
    check('callLen NOP ($EA) = 0 (not a call)', D.callLen(0xEA) === 0);
    const sp0 = { line: 10, file: 'main.c', sp: 0x1FF };
    check('step in stops on first line change', D.stepStops('in', sp0, { src: { file: 'main.c', line: 11 }, sp: 0x1FF }) === true);
    check('step in does not stop on same line', D.stepStops('in', sp0, { src: { file: 'main.c', line: 10 }, sp: 0x1FF }) === false);
    check('step over keeps going inside a call (deeper SP)', D.stepStops('over', sp0, { src: { file: 'main.c', line: 11 }, sp: 0x1F0 }) === false);
    check('step over stops at same depth, new line', D.stepStops('over', sp0, { src: { file: 'main.c', line: 11 }, sp: 0x1FF }) === true);
    check('step out stops only when frame returns (SP rises)', D.stepStops('out', sp0, { src: { file: 'main.c', line: 9 }, sp: 0x201 }) === true);
    check('step out does not stop within the frame', D.stepStops('out', sp0, { src: { file: 'main.c', line: 9 }, sp: 0x1FF }) === false);
    check('no C source -> never stops', D.stepStops('in', sp0, { src: undefined, sp: 0x1FF }) === false);

    // Typed local formatting (pure): little-endian, signedness, pointer, type name.
    check('formatLocal u16 -> decimal + hex', D.formatLocal({ name: 'pad', cls: 'u', size: 2, offset: 2 }, [0x00, 0x04]).value === '1024 (0x0400)');
    check('formatLocal s16 negative -> signed', D.formatLocal({ name: 'dx', cls: 's', size: 2, offset: 4 }, [0xFF, 0xFF]).value.startsWith('-1 '));
    check('formatLocal pointer -> hex', D.formatLocal({ name: 'p', cls: 'p', size: 2, offset: 6 }, [0x34, 0x12]).value === '0x1234');
    check('formatLocal carries the type name', D.formatLocal({ name: 'x', cls: 'u', size: 2, offset: 0 }, [0, 0]).type === 'u16');
    check('formatLocal u8', D.formatLocal({ name: 'b', cls: 'u', size: 1, offset: 0 }, [0x2A]).value === '42 (0x2A)');

    // Aggregate expansion (pure): child addresses of structs (by offset) and arrays (by stride).
    const cfgNode = { kind: 'struct', size: 8, fields: [
        { name: 'init', off: 0, type: { kind: 'scalar', cls: 'p', size: 4 } },
        { name: 'update', off: 4, type: { kind: 'scalar', cls: 'p', size: 4 } },
    ] };
    const ch = D.aggChildren(cfgNode, 0x100);
    check('aggChildren: struct fields at their offsets', ch.length === 2 && ch[0].addr === 0x100 && ch[1].addr === 0x104 && ch[1].name === 'update');
    const arrNode = { kind: 'array', size: 20, count: 10, elem: { kind: 'scalar', cls: 'u', size: 2 } };
    const ael = D.aggChildren(arrNode, 0x200);
    check('aggChildren: array elements strided by elem size', ael.length === 10 && ael[0].name === '[0]' && ael[2].addr === 0x204);
    check('aggChildren: arrays capped at 256', D.aggChildren({ kind: 'array', size: 4000, count: 2000, elem: { kind: 'scalar', cls: 'u', size: 2 } }, 0).length === 256);
    check('aggChildren: scalar has no children', D.aggChildren({ kind: 'scalar', cls: 'u', size: 2 }, 0).length === 0);

    const lunaBin2 = B.resolveLunaPath({ sdkPath: OPENSNES });
    if (!lunaBin2 || !fs.existsSync(lunaBin2)) {
        skipped('luna binary not available');
    } else {
        if (!fs.existsSync(ri.rom)) { cp.spawnSync('make', [], { cwd: aimDir }); }
        const session = new D.LunaDebugSession();
        const events = [];
        session.sendEvent = (e) => events.push(e);
        const dapCall = (method, args) => new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error(method + ' response timeout')), 40000);
            session.sendResponse = (r) => { clearTimeout(to); resolve(r); };
            const response = { seq: 0, type: 'response', request_seq: 0, success: true, command: method, body: {} };
            const ret = session[method + 'Request'](response, args ?? {});
            if (ret && typeof ret.catch === 'function') { ret.catch(reject); }
        });
        const waitEvent = (pred, ms = 40000) => new Promise((resolve, reject) => {
            const iv = setInterval(() => { const e = events.find(pred); if (e) { clearInterval(iv); clearTimeout(to); resolve(e); } }, 20);
            const to = setTimeout(() => { clearInterval(iv); reject(new Error('event timeout')); }, ms);
        });
        const stopped = (reason) => (e) => e.event === 'stopped' && e.body && e.body.reason === reason;
        try {
            const init = await dapCall('initialize', {});
            check('initialize: supportsFunctionBreakpoints', init.body.supportsFunctionBreakpoints === true);
            check('initialize emits InitializedEvent', events.some((e) => e.event === 'initialized'));

            await dapCall('launch', { program: ri.rom, lunaPath: lunaBin2, cwd: aimDir, stopOnEntry: true });
            const fb = await dapCall('setFunctionBreakPoints', { breakpoints: [{ name: 'InitHardware' }] });
            check('symbol breakpoint InitHardware verified', fb.body.breakpoints[0].verified === true);
            const fbBad = await dapCall('setFunctionBreakPoints', { breakpoints: [{ name: 'NoSuchSymbol' }] });
            check('unknown symbol breakpoint not verified', fbBad.body.breakpoints[0].verified === false);
            // re-arm the real breakpoint (the bad call cleared it)
            await dapCall('setFunctionBreakPoints', { breakpoints: [{ name: 'InitHardware' }] });

            await dapCall('configurationDone', {});
            await waitEvent(stopped('entry'));
            check('stopped at entry', true);

            await dapCall('continue', { threadId: 1 });
            await waitEvent(stopped('breakpoint'));
            check('stopped at the symbol breakpoint', true);

            const st = await dapCall('stackTrace', { threadId: 1 });
            check('stack frame names InitHardware', /InitHardware/.test(st.body.stackFrames[0].name));

            await dapCall('scopes', { frameId: 0 });
            const vars = await dapCall('variables', { variablesReference: 1000 });
            check('Registers PC === $00:8365 (breakpoint hit)', vars.body.variables.find((v) => v.name === 'PC').value === '$00:8365');

            // evaluate a symbol -> its first byte + a memoryReference (InitHardware = $C2)
            const ev = await dapCall('evaluate', { expression: 'InitHardware', context: 'watch' });
            check('evaluate(InitHardware) memoryReference 0x008365', ev.body.memoryReference === '0x008365');
            check('evaluate(InitHardware) shows first byte $C2', /\$C2$/.test(ev.body.result));

            // readMemory at that reference -> base64 of the real opcodes C2 10 E2
            const rm = await dapCall('readMemory', { memoryReference: '0x008365', count: 3 });
            const got = [...Buffer.from(rm.body.data, 'base64')];
            check('readMemory(InitHardware,3) === [C2,10,E2]', JSON.stringify(got) === JSON.stringify([0xC2, 0x10, 0xE2]));
            check('readMemory reports address 0x008365', rm.body.address === '0x008365');

            // data (memory-watch) breakpoint: stop when INIDISP $2100 is written
            const dbiReg = await dapCall('dataBreakpointInfo', { name: 'A', variablesReference: 1000 });
            check('dataBreakpointInfo on a register -> dataId null', dbiReg.body.dataId === null);
            const dbi = await dapCall('dataBreakpointInfo', { name: '$2100' });
            check('dataBreakpointInfo($2100) -> dataId 0x002100', dbi.body.dataId === '0x002100');
            check('dataBreakpointInfo offers write access', dbi.body.accessTypes.includes('write'));

            await dapCall('setFunctionBreakPoints', { breakpoints: [] }); // clear PC bps
            const sdb = await dapCall('setDataBreakpoints', { breakpoints: [{ dataId: '0x002100', accessType: 'write' }] });
            check('setDataBreakpoints verified', sdb.body.breakpoints[0].verified === true);

            await dapCall('continue', { threadId: 1 });
            await waitEvent(stopped('data breakpoint'));
            check('stopped at data breakpoint (mem write $2100)', true);
            const st2 = await dapCall('stackTrace', { threadId: 1 });
            check('data bp stopped in InitHardware', /InitHardware/.test(st2.body.stackFrames[0].name));

            // custom request feeding the palette viewer: live CGRAM at the stop
            const ppu = await new Promise((resolve, reject) => {
                const to = setTimeout(() => reject(new Error('cooperPpu timeout')), 40000);
                session.sendResponse = (r) => { clearTimeout(to); resolve(r); };
                const response = { seq: 0, type: 'response', request_seq: 0, success: true, command: 'cooperPpu', body: {} };
                const ret = session.customRequest('cooperPpu', response, {});
                if (ret && typeof ret.catch === 'function') { ret.catch(reject); }
            });
            check('cooperPpu returns 256 CGRAM words', Array.isArray(ppu.body.cgram) && ppu.body.cgram.length === 256);
            const decoded = P.decodeCgram(ppu.body.cgram);
            check('decoded palette has 256 RGB colours', decoded.length === 256 && typeof decoded[0].r === 'number');
            check('cooperPpu returns 544-byte OAM', Array.isArray(ppu.body.oam) && ppu.body.oam.length === 544);
            check('OAM decodes to 128 sprites', P.decodeOam(ppu.body.oam).length === 128);

            // VRAM custom request -> decode -> PNG (closes the tile path on the real binary)
            const vramResp = await new Promise((resolve, reject) => {
                const to = setTimeout(() => reject(new Error('cooperVram timeout')), 40000);
                session.sendResponse = (r) => { clearTimeout(to); resolve(r); };
                const response = { seq: 0, type: 'response', request_seq: 0, success: true, command: 'cooperVram', body: {} };
                const ret = session.customRequest('cooperVram', response, { offset: 0, count: 0x1000 });
                if (ret && typeof ret.catch === 'function') { ret.catch(reject); }
            });
            check('cooperVram returns 0x1000 bytes', Array.isArray(vramResp.body.bytes) && vramResp.body.bytes.length === 0x1000);

            // G5 v1: behavioral replay — hold Right long enough to clamp the
            // aim_target sprite at its right bound (target_x: 200 → 247, exact).
            const rep = await new Promise((resolve, reject) => {
                const to = setTimeout(() => reject(new Error('cooperReplay timeout')), 60000);
                session.sendResponse = (r) => { clearTimeout(to); resolve(r); };
                const response = { seq: 0, type: 'response', request_seq: 0, success: true, command: 'cooperReplay', body: {} };
                // hold Right until frame 200: the example's init takes ~50 frames,
                // leaving 145+ update ticks — enough to CLAMP target_x at 247 exactly.
                const ret = session.customRequest('cooperReplay', response, { script: '10:Right, 200:0' });
                if (ret && typeof ret.catch === 'function') { ret.catch(reject); }
            });
            check('cooperReplay ran to ~frame 202', rep.body.frames >= 200 && rep.body.frames <= 210);
            const evX = await dapCall('evaluate', { expression: 'target_x', context: 'watch' });
            check('replayed D-pad drove the game: target_x clamped at 247 ($F7)', /\$F7$/.test(evX.body.result));
            const sheet = T.tilesToRgba(T.decodeTileSheet(vramResp.body.bytes, 4, 0x1000 / 32), P.decodeCgram(ppu.body.cgram).slice(0, 16), 16);
            const pngBuf = T.encodePng(sheet.width, sheet.height, sheet.data);
            check('VRAM sheet encodes a valid PNG', pngBuf[0] === 0x89 && pngBuf.slice(1, 4).toString('ascii') === 'PNG');

            // SOURCE-LEVEL: a C-line breakpoint, then a stack frame carrying main.c:line.
            await dapCall('setDataBreakpoints', { breakpoints: [] });
            const sbp = await dapCall('setBreakPoints', { source: { path: path.join(aimDir, 'main.c') }, breakpoints: [{ line: 237 }] });
            check('source breakpoint verified (C line -> PC)', sbp.body.breakpoints[0].verified === true);
            check('source breakpoint bound to a real C line', typeof sbp.body.breakpoints[0].line === 'number');
            await dapCall('continue', { threadId: 1 });
            await waitEvent(stopped('breakpoint'));
            const st3 = await dapCall('stackTrace', { threadId: 1 });
            const fr = st3.body.stackFrames[0];
            check('stopped frame has a main.c source', !!fr.source && /main\.c$/.test(fr.source.path));
            check('stopped frame carries a C line', typeof fr.line === 'number' && fr.line > 0);

            const sc = await dapCall('scopes', { threadId: 1, frameId: 0 });
            check('a Locals scope is offered', sc.body.scopes.some((s) => s.name === 'Locals'));
            const localsRef = sc.body.scopes.find((s) => s.name === 'Locals').variablesReference;

            // C-LINE STEPPING: Step Over advances a whole C line, not one instruction.
            await dapCall('next', { threadId: 1 });
            await waitEvent(stopped('step'));
            const st4 = await dapCall('stackTrace', { threadId: 1 });
            const fr2 = st4.body.stackFrames[0];
            check('C-line step lands on main.c', !!fr2.source && /main\.c$/.test(fr2.source.path));
            check('C-line step advanced to a different C line', typeof fr2.line === 'number' && fr2.line !== fr.line);

            // TYPED LOCALS (G4): stop deterministically inside on_update (a function
            // with C locals), step past the prologue, then read its typed locals.
            await dapCall('setBreakPoints', { source: { path: path.join(aimDir, 'main.c') }, breakpoints: [] });
            await dapCall('setFunctionBreakPoints', { breakpoints: [{ name: 'on_update' }] });
            await dapCall('continue', { threadId: 1 });
            await waitEvent(stopped('breakpoint'));
            await dapCall('next', { threadId: 1 }); // step OVER the prologue/first call → stay in on_update
            await waitEvent(stopped('step'));
            const lv = await dapCall('variables', { variablesReference: localsRef });
            check('Locals are read for the current function', Array.isArray(lv.body.variables) && lv.body.variables.length > 0);
            check('Locals include pad (u16) with a value', lv.body.variables.some((v) => v.name === 'pad' && v.type === 'u16' && v.value));
            check('Locals are typed (signed/unsigned/pointer/struct)', lv.body.variables.every((v) => /^[us]\d+$|pointer|struct|array|float|bytes/.test(v.type)));

            await dapCall('disconnect', {});
            check('disconnect ok', true);
        } catch (e) {
            check('DAP session threw: ' + String((e && e.message) || e), false);
            try { session.disconnectRequest({ body: {} }, {}); } catch {}
        }
    }
    try { fs.unlinkSync(tmpD); } catch {}

    console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
    if (skip && process.env.COOPER_REQUIRE_TOOLS) {
        console.error(`COOPER_REQUIRE_TOOLS is set but ${skip} group(s) skipped (missing tools) — failing.`);
        process.exit(1);
    }
    process.exit(fail ? 1 : 0);
})();
