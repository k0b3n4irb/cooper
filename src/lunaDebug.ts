// The Luna debug adapter — a DAP `DebugSession` over the luna MCP backend + the
// WLA `.sym` symbol layer. Imports `@vscode/debugadapter` (plain Node, NOT the
// `vscode` module), so the whole session is Node-testable headlessly; only the
// inline-factory registration in extension.ts touches `vscode`.
//
// MVP (P2.1b), ASM/symbol level — grounded in D-016/D-018:
//  - breakpoints = FUNCTION breakpoints: a symbol name → addr (`.sym`) →
//    `run_until_pc` (no line↔PC nor disassembler yet, so source/instruction
//    breakpoints wait for G0/P7).
//  - one thread (the 65816); stack = 1 frame (PC → nearest symbol).
//  - Registers scope from `state.cpu`; step = `step{1}`.

import {
    LoggingDebugSession, InitializedEvent, StoppedEvent, TerminatedEvent,
    OutputEvent, Thread, StackFrame, Scope, Source,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'path';
import * as fs from 'fs';
import { LunaMcp, CpuState } from './lunaMcp';
import {
    parseSym, SymTable, symbolToAddr, addrToSymbol, formatResolved, resolveExpr, parseAddress,
    buildCLineMap, CLineMap, CSource, cSourceForAddr, resolveLine,
    parseLocals, LocalVar, parseFunctions, buildFuncRanges, enclosingFunction, FuncRange,
} from './sym';

const THREAD_ID = 1;
const REGISTERS_REF = 1000;
const LOCALS_REF = 1001;

interface LunaLaunchArgs extends DebugProtocol.LaunchRequestArguments {
    /** Path to the .sfc ROM to debug. */
    program: string;
    /** Path to the luna binary (else resolved by the caller / extension). */
    lunaPath: string;
    /** Stop at the reset vector on launch (default true). */
    stopOnEntry?: boolean;
    /** Working directory for the luna process. */
    cwd?: string;
    /** Instruction budget for a "continue" before it pauses (default 5,000,000). */
    maxSteps?: number;
}

/** Hex helper: `$00AB`-style, upper-case, fixed width. */
function hex(n: number, width: number): string {
    return '$' + (n >>> 0).toString(16).toUpperCase().padStart(width, '0');
}

/** Canonical DAP memoryReference for a 24-bit address: `0x00ABCD`. */
function memRef(addr: number): string {
    return '0x' + (addr >>> 0).toString(16).toUpperCase().padStart(6, '0');
}

/** Decode the 65816 status byte P into `nvmxdizc` (set bits upper-case). */
export function decodeP(p: number): string {
    const bits = ['c', 'z', 'i', 'd', 'x', 'm', 'v', 'n']; // bit0..bit7
    let s = '';
    for (let bit = 7; bit >= 0; bit--) {
        s += (p & (1 << bit)) ? bits[bit].toUpperCase() : bits[bit];
    }
    return s;
}

/** Pure: format a CPU state as DAP register variables (testable without a binary).
 *  Address-like registers carry a `memoryReference` so the hex viewer can open
 *  at their value (PC at PB:PC; 16-bit regs at bank 0). */
export function formatRegisters(cpu: CpuState): DebugProtocol.Variable[] {
    const v = (name: string, value: string, ref?: number): DebugProtocol.Variable =>
        ({ name, value, variablesReference: 0, ...(ref !== undefined ? { memoryReference: memRef(ref) } : {}) });
    return [
        v('PC', `${hex(cpu.pb, 2)}:${hex(cpu.pc, 4).slice(1)}`, ((cpu.pb << 16) | cpu.pc) >>> 0),
        v('A', hex(cpu.a, 4), cpu.a & 0xFFFF),
        v('X', hex(cpu.x, 4), cpu.x & 0xFFFF),
        v('Y', hex(cpu.y, 4), cpu.y & 0xFFFF),
        v('SP', hex(cpu.sp, 4), cpu.sp & 0xFFFF),
        v('DP', hex(cpu.dp, 4), cpu.dp & 0xFFFF),
        v('DB', hex(cpu.db, 2)),
        v('PB', hex(cpu.pb, 2)),
        v('P', `${hex(cpu.p, 2)} (${decodeP(cpu.p)})`),
        v('E', String(cpu.e)),
    ];
}

function localTypeName(loc: LocalVar): string {
    switch (loc.cls) {
        case 'u': return `u${loc.size * 8}`;
        case 's': return `s${loc.size * 8}`;
        case 'p': return 'pointer';
        case 'a': return `array[${loc.size}]`;
        case 'g': return `struct(${loc.size}B)`;
        case 'f': return `float${loc.size * 8}`;
        default: return `bytes(${loc.size})`;
    }
}

/** Pure: format a C local's raw little-endian bytes as a typed DAP variable. */
export function formatLocal(loc: LocalVar, bytes: number[]): DebugProtocol.Variable {
    const n = bytes.length;
    let raw = 0;
    for (let i = n - 1; i >= 0; i--) {
        raw = raw * 256 + (bytes[i] & 0xFF);
    }
    const hexVal = '0x' + raw.toString(16).toUpperCase().padStart(n * 2, '0');
    let value: string;
    if (loc.cls === 'p') {
        value = hexVal;
    } else if (loc.cls === 's') {
        const sv = (n > 0 && (bytes[n - 1] & 0x80)) ? raw - Math.pow(2, 8 * n) : raw;
        value = `${sv} (${hexVal})`;
    } else if (loc.cls === 'u') {
        value = `${raw} (${hexVal})`;
    } else {
        value = `${hexVal} <${loc.size}B>`;
    }
    return { name: loc.name, value, type: localTypeName(loc), variablesReference: 0 };
}

export type StepMode = 'in' | 'over' | 'out';
export interface StepPoint { line: number; file: string; sp: number; }

/** 65816 call instruction → its byte length (for step-over to skip the call body
 *  via run_until_pc), else 0. JSR abs ($20) / JSR (abs,X) ($FC) = 3, JSL ($22) = 4. */
export function callLen(opcode: number): number {
    if (opcode === 0x20 || opcode === 0xFC) {
        return 3;
    }
    if (opcode === 0x22) {
        return 4;
    }
    return 0;
}

/** Pure decision for source-level stepping. The 65816 stack grows DOWN (a push
 *  decrements SP), so a deeper call has a SMALLER SP; returning raises it.
 *  - `in`:   stop at the first changed C line (entering calls is fine);
 *  - `over`: stop at a changed line once back at the start frame or shallower;
 *  - `out`:  stop once we've returned to a shallower frame. */
export function stepStops(mode: StepMode, start: StepPoint, cur: { src?: CSource; sp: number }): boolean {
    if (!cur.src) {
        return false;
    }
    const lineChanged = cur.src.file !== start.file || cur.src.line !== start.line;
    if (mode === 'out') {
        return cur.sp > start.sp;
    }
    if (mode === 'over') {
        return lineChanged && cur.sp >= start.sp;
    }
    return lineChanged;
}

export class LunaDebugSession extends LoggingDebugSession {
    private mcp = new LunaMcp();
    private sym: SymTable | null = null;
    private cmap: CLineMap | null = null;     // PC ↔ C source (source-level debug)
    private locals = new Map<string, LocalVar[]>(); // function name → its C locals (-g builds)
    private funcRanges: FuncRange[] = [];     // sorted function entries (PC → enclosing fn)
    private projectDir = '';
    private breakpoints: number[] = [];       // function-breakpoint PC addresses
    private sourceBreakpoints: number[] = []; // source-line-breakpoint PC addresses
    private dataBreakpoints: { addr: number; access: DebugProtocol.DataBreakpointAccessType }[] = [];
    private configurationDone = false;
    private stopOnEntry = true;
    private maxSteps = 5_000_000;

    /** All PC breakpoints (function + source), deduped. */
    private pcBreakpoints(): number[] {
        return [...new Set([...this.breakpoints, ...this.sourceBreakpoints])];
    }

    constructor() {
        super('luna-debug.txt');
        this.setDebuggerLinesStartAt1(true);
        this.setDebuggerColumnsStartAt1(true);
    }

    protected initializeRequest(response: DebugProtocol.InitializeResponse): void {
        response.body = response.body ?? {};
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsFunctionBreakpoints = true;
        response.body.supportsSteppingGranularity = true;
        response.body.supportsReadMemoryRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsDataBreakpoints = true;
        response.body.supportsRestartRequest = false;
        // Source breakpoints handled in setBreakPointsRequest (no extra capability).
        response.body.supportsStepBack = false;
        this.sendResponse(response);
        // Tell the client we're ready to receive breakpoint configuration.
        this.sendEvent(new InitializedEvent());
    }

    protected async launchRequest(response: DebugProtocol.LaunchResponse, args: LunaLaunchArgs): Promise<void> {
        this.stopOnEntry = args.stopOnEntry !== false;
        if (typeof args.maxSteps === 'number' && args.maxSteps > 0) {
            this.maxSteps = args.maxSteps;
        }
        try {
            await this.mcp.connect(args.lunaPath, args.cwd ?? path.dirname(args.program));
            await this.mcp.loadRom(args.program);
        } catch (e) {
            this.sendErrorResponse(response, 3001, `luna launch failed: ${(e as Error).message}`);
            return;
        }
        this.projectDir = args.cwd ?? path.dirname(args.program);
        // Load the sibling `.sym` for symbol resolution (best-effort).
        const symPath = args.program.replace(/\.(sfc|smc)$/i, '') + '.sym';
        if (fs.existsSync(symPath)) {
            this.sym = parseSym(fs.readFileSync(symPath, 'utf8'));
            this.sendEvent(new OutputEvent(`Loaded symbols: ${path.basename(symPath)} (${this.sym.labels.length} labels)\n`, 'console'));
            // Source-level: join the .sym addr-to-line with the `; @cline` markers
            // in the generated asm (built with wla -i / wlalink -A + patched cproc).
            if (this.sym.hasLineInfo) {
                const asmTexts = new Map<string, string>();
                for (const fname of new Set(this.sym.sourceFiles.values())) {
                    const p = path.isAbsolute(fname) ? fname : path.join(this.projectDir, fname);
                    try {
                        if (fs.existsSync(p)) {
                            asmTexts.set(fname, fs.readFileSync(p, 'utf8'));
                        }
                    } catch { /* skip unreadable */ }
                }
                this.cmap = buildCLineMap(this.sym, asmTexts);
                const asmJoined = [...asmTexts.values()].join('\n');
                this.locals = parseLocals(asmJoined);
                this.funcRanges = buildFuncRanges(this.sym, parseFunctions(asmJoined));
                if (this.cmap.addrToSource.size > 0) {
                    const nLoc = [...this.locals.values()].reduce((s, a) => s + a.length, 0);
                    this.sendEvent(new OutputEvent(`Source-level debug: ${this.cmap.addrToSource.size} C-line mappings, ${nLoc} locals.\n`, 'console'));
                }
            }
        } else {
            this.sendEvent(new OutputEvent(`No .sym next to ${path.basename(args.program)} — symbol breakpoints unavailable.\n`, 'console'));
        }
        this.sendResponse(response);

        // Wait for the client to finish setting breakpoints, then stop on entry.
        await this.waitForConfigurationDone();
        if (this.stopOnEntry) {
            this.sendEvent(new StoppedEvent('entry', THREAD_ID));
        } else {
            await this.runToBreakpoints(response);
        }
    }

    private resolveSignal: (() => void) | null = null;
    private waitForConfigurationDone(): Promise<void> {
        if (this.configurationDone) {
            return Promise.resolve();
        }
        return new Promise<void>((res) => { this.resolveSignal = res; });
    }

    protected configurationDoneRequest(response: DebugProtocol.ConfigurationDoneResponse): void {
        this.configurationDone = true;
        this.sendResponse(response);
        if (this.resolveSignal) {
            this.resolveSignal();
            this.resolveSignal = null;
        }
    }

    protected setFunctionBreakPointsRequest(
        response: DebugProtocol.SetFunctionBreakpointsResponse,
        args: DebugProtocol.SetFunctionBreakpointsArguments,
    ): void {
        const bps: DebugProtocol.Breakpoint[] = [];
        this.breakpoints = [];
        for (const fb of args.breakpoints) {
            const addr = this.sym ? symbolToAddr(this.sym, fb.name.trim()) : undefined;
            if (addr !== undefined) {
                this.breakpoints.push(addr);
                bps.push({ verified: true, instructionReference: hex(addr, 6) });
            } else {
                bps.push({ verified: false, message: `unknown symbol '${fb.name}'` });
            }
        }
        response.body = { breakpoints: bps };
        this.sendResponse(response);
    }

    /** Source-line breakpoints (clicking the editor gutter): resolve each C line
     *  to a PC via the cproc/`@cline` map, then run_until_pc to it. */
    protected setBreakPointsRequest(
        response: DebugProtocol.SetBreakpointsResponse,
        args: DebugProtocol.SetBreakpointsArguments,
    ): void {
        const file = args.source.path ? path.basename(args.source.path) : '';
        const bps: DebugProtocol.Breakpoint[] = [];
        this.sourceBreakpoints = [];
        for (const b of args.breakpoints ?? []) {
            const r = this.cmap ? resolveLine(this.cmap, file, b.line) : undefined;
            if (r) {
                this.sourceBreakpoints.push(r.addr);
                bps.push({ verified: true, line: r.line, source: args.source });
            } else {
                bps.push({
                    verified: false, line: b.line,
                    message: this.cmap ? 'no code at or after this line' : 'build with source-level debug info (wla -i / wlalink -A)',
                });
            }
        }
        response.body = { breakpoints: bps };
        this.sendResponse(response);
    }

    /** Can a data (memory-watch) breakpoint be set on this name/expression?
     *  Resolves a `.sym` symbol or literal address → a dataId (the address). */
    protected dataBreakpointInfoRequest(
        response: DebugProtocol.DataBreakpointInfoResponse,
        args: DebugProtocol.DataBreakpointInfoArguments,
    ): void {
        // Registers are not memory-backed — no data breakpoint on a register.
        const addr = (args.variablesReference === REGISTERS_REF || !this.sym)
            ? undefined
            : resolveExpr(this.sym, args.name);
        if (addr === undefined) {
            response.body = { dataId: null, description: `cannot watch '${args.name}'` };
        } else {
            response.body = {
                dataId: memRef(addr),
                description: `${args.name} @ ${memRef(addr)}`,
                accessTypes: ['read', 'write', 'readWrite'],
                canPersist: false,
            };
        }
        this.sendResponse(response);
    }

    protected setDataBreakpointsRequest(
        response: DebugProtocol.SetDataBreakpointsResponse,
        args: DebugProtocol.SetDataBreakpointsArguments,
    ): void {
        this.dataBreakpoints = [];
        const bps: DebugProtocol.Breakpoint[] = [];
        for (const db of args.breakpoints) {
            const addr = parseAddress(db.dataId);
            if (addr !== undefined) {
                this.dataBreakpoints.push({ addr, access: db.accessType ?? 'write' });
                bps.push({ verified: true });
            } else {
                bps.push({ verified: false, message: `bad dataId '${db.dataId}'` });
            }
        }
        response.body = { breakpoints: bps };
        this.sendResponse(response);
    }

    protected threadsRequest(response: DebugProtocol.ThreadsResponse): void {
        response.body = { threads: [new Thread(THREAD_ID, '65816 (main CPU)')] };
        this.sendResponse(response);
    }

    protected async stackTraceRequest(
        response: DebugProtocol.StackTraceResponse,
        _args: DebugProtocol.StackTraceArguments,
    ): Promise<void> {
        const cpu = await this.mcp.cpu();
        const pc24 = ((cpu.pb << 16) | cpu.pc) >>> 0;
        const resolved = this.sym ? addrToSymbol(this.sym, pc24) : undefined;
        const name = resolved
            ? `${formatResolved(resolved)} @ ${hex(cpu.pb, 2)}:${hex(cpu.pc, 4).slice(1)}`
            : `${hex(cpu.pb, 2)}:${hex(cpu.pc, 4).slice(1)}`;
        const frame = new StackFrame(0, name);
        frame.instructionPointerReference = hex(pc24, 6);
        // Source-level: attach the C file + line so VS Code highlights it.
        const csrc = this.cmap ? cSourceForAddr(this.cmap, pc24) : undefined;
        if (csrc) {
            frame.source = new Source(path.basename(csrc.file), path.join(this.projectDir, csrc.file));
            frame.line = csrc.line;
            frame.column = 1;
        }
        response.body = { stackFrames: [frame], totalFrames: 1 };
        this.sendResponse(response);
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse): void {
        response.body = { scopes: [new Scope('Locals', LOCALS_REF, false), new Scope('Registers', REGISTERS_REF, false)] };
        this.sendResponse(response);
    }

    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments,
    ): Promise<void> {
        if (args.variablesReference === REGISTERS_REF) {
            const cpu = await this.mcp.cpu();
            response.body = { variables: formatRegisters(cpu) };
        } else if (args.variablesReference === LOCALS_REF) {
            response.body = { variables: await this.readLocals() };
        } else {
            response.body = { variables: [] };
        }
        this.sendResponse(response);
    }

    /** Read the current function's C locals from the stack frame. The frame base
     *  is the stack pointer at a stop (statement boundary); each local sits at
     *  `S + offset` in bank 0. Source-level (`-g`) builds only. */
    private async readLocals(): Promise<DebugProtocol.Variable[]> {
        if (!this.sym) {
            return [];
        }
        const cpu = await this.mcp.cpu();
        const pc = ((cpu.pb << 16) | cpu.pc) >>> 0;
        const fn = enclosingFunction(this.funcRanges, pc);
        const locs = fn ? this.locals.get(fn) : undefined;
        if (!locs || locs.length === 0) {
            return [];
        }
        const base = cpu.sp & 0xFFFF;
        const out: DebugProtocol.Variable[] = [];
        for (const loc of locs) {
            const off = (base + loc.offset) & 0xFFFF;
            try {
                const bytes = await this.mcp.peekMemory(0, off, loc.size);
                out.push(formatLocal(loc, bytes));
            } catch { /* skip unreadable */ }
        }
        return out;
    }

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        _args: DebugProtocol.ContinueArguments,
    ): Promise<void> {
        await this.runToBreakpoints(response);
    }

    /**
     * Run to the first breakpoint. luna watches ONE condition per run (D-016), so:
     *  - a single data (memory-watch) breakpoint → `run_until_mem_*` (exact);
     *  - a single PC breakpoint → `run_until_pc` (exact);
     *  - multiple PC breakpoints → chunked single-step scan (may overshoot);
     *  - mixing kinds / >1 data bp → only the first data bp is honored (warned).
     */
    private async runToBreakpoints(response: DebugProtocol.Response): Promise<void> {
        response.body = { ...(response.body ?? {}), allThreadsContinued: true };
        this.sendResponse(response);

        const pcs = this.pcBreakpoints();
        let reason = 'pause';
        try {
            if (this.dataBreakpoints.length >= 1) {
                if (this.dataBreakpoints.length > 1 || pcs.length > 0) {
                    this.sendEvent(new OutputEvent('luna watches one address per run — only the first data breakpoint is honored this continue.\n', 'console'));
                }
                const d = this.dataBreakpoints[0];
                const r = d.access === 'read'
                    ? await this.mcp.runUntilMemRead(d.addr, this.maxSteps)
                    : await this.mcp.runUntilMemWrite(d.addr, this.maxSteps);  // write | readWrite
                if (r.hit) {
                    reason = 'data breakpoint';
                }
            } else if (pcs.length === 1) {
                if ((await this.mcp.runUntilPc(pcs[0], this.maxSteps)).hit) {
                    reason = 'breakpoint';
                }
            } else if (pcs.length > 1) {
                if (await this.scanForBreakpoints()) {
                    reason = 'breakpoint';
                }
            } else {
                // No breakpoints: advance a bounded budget, then pause.
                await this.mcp.step(Math.min(this.maxSteps, 200000));
            }
        } catch (e) {
            this.sendEvent(new OutputEvent(`continue failed: ${(e as Error).message}\n`, 'stderr'));
            this.sendEvent(new TerminatedEvent());
            return;
        }
        this.sendEvent(new StoppedEvent(reason, THREAD_ID));
    }

    /** Chunked single-step scan for >1 breakpoint (may overshoot — D-016 gap). */
    private async scanForBreakpoints(): Promise<boolean> {
        const set = new Set(this.pcBreakpoints());
        let steps = 0;
        const chunk = 2000;
        while (steps < this.maxSteps) {
            await this.mcp.step(Math.min(chunk, this.maxSteps - steps));
            steps += chunk;
            const cpu = await this.mcp.cpu();
            if (set.has(((cpu.pb << 16) | cpu.pc) >>> 0)) {
                return true;
            }
        }
        return false;
    }

    protected async nextRequest(response: DebugProtocol.NextResponse): Promise<void> {
        await this.stepLine(response, 'over');
    }
    protected async stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
        await this.stepLine(response, 'in');
    }
    protected async stepOutRequest(response: DebugProtocol.StepOutResponse): Promise<void> {
        await this.stepLine(response, 'out');
    }

    /**
     * Source-level stepping: advance until the C source LINE changes (not a single
     * instruction). `over` skips subroutine calls wholesale via `run_until_pc`;
     * `out` runs until the current frame returns; `in` stops at the first new line.
     * Falls back to a single instruction when there is no C-line info at the PC.
     */
    private async stepLine(response: DebugProtocol.Response, mode: StepMode): Promise<void> {
        this.sendResponse(response);
        try {
            const s = await this.mcp.cpu();
            const startPc = ((s.pb << 16) | s.pc) >>> 0;
            const startSrc = this.cmap ? cSourceForAddr(this.cmap, startPc) : undefined;
            if (!startSrc) {
                await this.mcp.step(1); // no C context → instruction-level step
                this.sendEvent(new StoppedEvent('step', THREAD_ID));
                return;
            }
            const start: StepPoint = { line: startSrc.line, file: startSrc.file, sp: s.sp & 0xFFFF };
            const bps = new Set(this.pcBreakpoints());
            let reason = 'step';
            for (let budget = 200000; budget > 0; budget--) {
                if (mode === 'over') {
                    const c0 = await this.mcp.cpu();
                    const [op] = await this.mcp.peekMemory(c0.pb, c0.pc, 1);
                    const len = callLen(op ?? 0);
                    if (len > 0) {
                        const ret = ((c0.pb << 16) | ((c0.pc + len) & 0xFFFF)) >>> 0;
                        await this.mcp.runUntilPc(ret, this.maxSteps); // skip the call body
                    } else {
                        await this.mcp.step(1);
                    }
                } else {
                    await this.mcp.step(1);
                }
                const cpu = await this.mcp.cpu();
                const pc = ((cpu.pb << 16) | cpu.pc) >>> 0;
                if (bps.has(pc)) {
                    reason = 'breakpoint';
                    break;
                }
                const cur = { src: this.cmap ? cSourceForAddr(this.cmap, pc) : undefined, sp: cpu.sp & 0xFFFF };
                if (stepStops(mode, start, cur)) {
                    break;
                }
            }
            this.sendEvent(new StoppedEvent(reason, THREAD_ID));
        } catch (e) {
            this.sendEvent(new OutputEvent(`step failed: ${(e as Error).message}\n`, 'stderr'));
            this.sendEvent(new StoppedEvent('step', THREAD_ID));
        }
    }

    /** Evaluate a symbol or address (Watch/hover/REPL): show its first byte and
     *  hand back a `memoryReference` so the hex viewer can open there. */
    protected async evaluateRequest(
        response: DebugProtocol.EvaluateResponse,
        args: DebugProtocol.EvaluateArguments,
    ): Promise<void> {
        const expr = (args.expression ?? '').trim();
        const addr = this.sym ? resolveExpr(this.sym, expr) : undefined;
        if (addr === undefined) {
            this.sendErrorResponse(response, 3002, `cannot resolve '${expr}' to a symbol or address`);
            return;
        }
        try {
            const [byte] = await this.mcp.peekMemory(addr >>> 16, addr & 0xFFFF, 1);
            response.body = {
                result: `${memRef(addr)} = ${hex(byte ?? 0, 2)}`,
                type: 'u8',
                variablesReference: 0,
                memoryReference: memRef(addr),
            };
        } catch (e) {
            this.sendErrorResponse(response, 3003, `peek failed: ${(e as Error).message}`);
            return;
        }
        this.sendResponse(response);
    }

    /** Read CPU-bus memory (WRAM/ROM/MMIO) for the hex viewer. VRAM/ARAM later. */
    protected async readMemoryRequest(
        response: DebugProtocol.ReadMemoryResponse,
        args: DebugProtocol.ReadMemoryArguments,
    ): Promise<void> {
        const base = parseAddress(args.memoryReference);
        if (base === undefined) {
            this.sendErrorResponse(response, 3004, `bad memoryReference '${args.memoryReference}'`);
            return;
        }
        const addr = (base + (args.offset ?? 0)) >>> 0;
        const bank = addr >>> 16;
        const off = addr & 0xFFFF;
        // peek_memory's window is one bank (offset/count are 16-bit).
        const count = Math.max(0, Math.min(args.count, 0x10000 - off));
        try {
            const bytes = await this.mcp.peekMemory(bank, off, count);
            response.body = {
                address: memRef(addr),
                data: Buffer.from(bytes).toString('base64'),
                unreadableBytes: args.count - bytes.length,
            };
        } catch (e) {
            this.sendErrorResponse(response, 3005, `peek failed: ${(e as Error).message}`);
            return;
        }
        this.sendResponse(response);
    }

    /** Custom requests for Cooper viewers (e.g. the palette webview reads
     *  `cooperPpu` → the live CGRAM/OAM at the current stop). */
    protected async customRequest(command: string, response: DebugProtocol.Response, args: unknown): Promise<void> {
        if (command === 'cooperPpu') {
            try {
                const s = await this.mcp.state();
                const ppu = (s.ppu ?? {}) as Record<string, unknown>;
                response.body = {
                    cgram: ppu.cgram ?? [],
                    oam: ppu.oam_full ?? [],
                    bgmode: ppu.bgmode ?? 0,
                    inidisp: ppu.inidisp ?? 0,
                    backdrop: ppu.backdrop ?? 0,
                };
                this.sendResponse(response);
            } catch (e) {
                this.sendErrorResponse(response, 3006, `ppu read failed: ${(e as Error).message}`);
            }
            return;
        }
        if (command === 'cooperVram') {
            const a = (args ?? {}) as { offset?: number; count?: number };
            try {
                response.body = { bytes: await this.mcp.peekVram(a.offset ?? 0, a.count ?? 0x4000) };
                this.sendResponse(response);
            } catch (e) {
                this.sendErrorResponse(response, 3007, `vram read failed: ${(e as Error).message}`);
            }
            return;
        }
        super.customRequest(command, response, args);
    }

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse): void {
        this.mcp.dispose();
        this.sendResponse(response);
    }
}
