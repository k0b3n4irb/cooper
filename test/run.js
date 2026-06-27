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
try { fs.unlinkSync(tmpS); } catch {}

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
