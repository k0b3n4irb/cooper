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
    console.log('  SKIP  clang not available');
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
const bma = B.buildMakeArgs('/sdk');
check('buildMakeArgs passes OPENSNES first', bma[0] === 'OPENSNES=/sdk');
check('buildMakeArgs adds wla -i (asm line info)', bma.some((x) => /\/bin\/wla-65816 -i$/.test(x)));
check('buildMakeArgs adds wlalink -A (addr-to-line)', bma.some((x) => /\/bin\/wlalink -A$/.test(x)));
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
    console.log('  SKIP  cc65816 not available');
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
    console.log('  SKIP  luna binary not available');
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
check('dashboard has Build/Run/Debug + viewer cards (7 actions)', (dash.match(/data-cmd=/g) || []).length === 7);
check('dashboard script gated by a nonce (CSP)', dash.includes("script-src 'nonce-NONCE0'") && dash.includes('nonce="NONCE0"'));
check('dashboard allows data: images for the preview', dash.includes('img-src vscode-csp data:'));
check('dashboard reflects status (luna ready, ROM built)', dash.includes('ready') && dash.includes('built'));
check('dashboard has a preview image slot', dash.includes('id="preview"'));
check('dashboard empty state when no project',
    D2.renderDashboardHtml({ hasProject: false, projectName: '', romBuilt: false, sdkName: null, lunaFound: false }, 'csp', 'N').includes('Open an OpenSNES project'));
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
        console.log('  SKIP  luna binary not available');
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
        } catch (e) {
            check('MCP end-to-end threw: ' + String((e && e.message) || e), false);
        } finally {
            m.dispose();
        }
    }
    try { fs.unlinkSync(tmpM); } catch {}

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

    const lunaBin2 = B.resolveLunaPath({ sdkPath: OPENSNES });
    if (!lunaBin2 || !fs.existsSync(lunaBin2)) {
        console.log('  SKIP  luna binary not available');
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

    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(fail ? 1 : 0);
})();
