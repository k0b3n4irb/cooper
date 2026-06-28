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
check('makeArgs: default goal is empty argv', JSON.stringify(B.makeArgs()) === '[]');
check('makeArgs: clean → ["clean"]', JSON.stringify(B.makeArgs('clean')) === '["clean"]');

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
if (!fs.existsSync(symPath)) {
    console.log('  (building aim_target to produce the .sym)');
    cp.spawnSync('make', [], { cwd: aimDir, encoding: 'utf8' });
}
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

// Today's .sym is labels-only (no addr-to-line until G0 build flags).
check('hasLineInfo is false (labels-only today)', sym.hasLineInfo === false);
check('sections parsed (ROM + RAM)', sym.sections.some((s) => s.kind === 'rom') && sym.sections.some((s) => s.kind === 'ram'));

// address parsing + expression resolution (for evaluate / memory view)
check('parseAddress($008365)', S.parseAddress('$008365') === 0x008365);
check('parseAddress(0x7E0030)', S.parseAddress('0x7E0030') === 0x7E0030);
check('parseAddress(7E:0030)', S.parseAddress('7E:0030') === 0x7E0030);
check('parseAddress(garbage) undefined', S.parseAddress('zzz') === undefined);
check('resolveExpr(symbol) wins', S.resolveExpr(sym, 'InitHardware') === 0x008365);
check('resolveExpr(literal) falls through', S.resolveExpr(sym, '$7E0030') === 0x7E0030);
try { fs.unlinkSync(tmpS); } catch {}

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
            await waitEvent(stopped('function breakpoint'));
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
