// The Luna debug adapter — a DAP `DebugSession` over the luna MCP backend + the
// WLA `.sym` symbol layer. Imports `@vscode/debugadapter` (plain Node, NOT the
// `vscode` module), so the whole session is Node-testable headlessly; only the
// inline-factory registration in extension.ts touches `vscode`.
//
// Breakpoints: function + source-line breakpoints resolve to PCs (`.sym` +
// `@cline` map) and are mirrored — together with data watchpoints — into luna's
// native breakpoint registry (`bp_add`, luna ≥ v1.6.0); a continue is ONE
// `run_until_break` at full speed, all breakpoints honoured (D-045; the old
// one-condition-per-run chunked scan from D-016 is gone).
// One thread (the 65816); Registers scope from `state.cpu`; step = `step{1}`.

import {
    LoggingDebugSession, InitializedEvent, StoppedEvent, TerminatedEvent,
    OutputEvent, Thread, StackFrame, Scope, Source,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'path';
import * as fs from 'fs';
import { LunaMcp, CpuState } from './lunaMcp';
import { parseInputScript, maskToButtons } from './inputScript';
import {
    parseSym, SymTable, symbolToAddr, addrToSymbol, formatResolved, resolveExpr, parseAddress,
    buildCLineMap, CLineMap, CSource, cSourceForAddr, resolveLine,
    parseLocals, LocalVar, parseFunctions, buildFuncRanges, enclosingFunction, FuncRange,
    parseAggregates, AggNode,
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

/** Pure: the child variables of an aggregate at `addr` — struct fields at their
 *  offsets, or array elements at `i * elemSize`. Address arithmetic only, no I/O
 *  (the caller reads memory for scalar leaves). Arrays are capped at 256. */
export function aggChildren(node: AggNode, addr: number): { name: string; addr: number; node: AggNode }[] {
    if (node.kind === 'struct') {
        return node.fields.map((f) => ({ name: f.name, addr: (addr + f.off) & 0xFFFF, node: f.type }));
    }
    if (node.kind === 'array') {
        const out: { name: string; addr: number; node: AggNode }[] = [];
        for (let i = 0; i < Math.min(node.count, 256); i++) {
            out.push({ name: `[${i}]`, addr: (addr + i * node.elem.size) & 0xFFFF, node: node.elem });
        }
        return out;
    }
    return [];
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
    private mcp: LunaMcp;
    private sym: SymTable | null = null;
    private cmap: CLineMap | null = null;     // PC ↔ C source (source-level debug)
    private locals = new Map<string, LocalVar[]>(); // function name → its C locals (-g builds)
    private funcRanges: FuncRange[] = [];     // sorted function entries (PC → enclosing fn)
    private aggregates = new Map<string, AggNode>(); // `func name` → struct/array type tree
    private varRefs = new Map<number, { addr: number; node: AggNode }>(); // expandable aggregate refs
    private nextVarRef = LOCALS_REF + 1000;   // dynamic variablesReference allocator
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

    constructor(onLog?: (line: string) => void) {
        super('luna-debug.txt');
        this.mcp = new LunaMcp({ onLog });
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
            // Also load it into luna itself, so disassembly/traces annotate symbols
            // and address-taking tools accept `symbol:` (best-effort, luna ≥ 1.6).
            try {
                await this.mcp.loadSymbols(symPath);
            } catch { /* older luna: Cooper-side resolution still works */ }
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
                // Aggregate layouts from the `.dbg` sidecar next to each C source
                // (main.c.wrap.asm → main.c.dbg): struct/array trees for expansion.
                for (const fname of new Set(this.sym.sourceFiles.values())) {
                    const base = fname.replace(/\.wrap\.asm$/, '').replace(/\.asm$/, '');
                    const p = path.isAbsolute(base) ? `${base}.dbg` : path.join(this.projectDir, `${base}.dbg`);
                    try {
                        if (fs.existsSync(p)) {
                            for (const [k, v] of parseAggregates(fs.readFileSync(p, 'utf8'))) {
                                this.aggregates.set(k, v);
                            }
                        }
                    } catch { /* skip */ }
                }
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
        // Aggregate expansion refs are per-stop; the client re-requests scopes on
        // each stop, so reset the dynamic ref allocator here.
        this.varRefs.clear();
        this.nextVarRef = LOCALS_REF + 1000;
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
        } else if (this.varRefs.has(args.variablesReference)) {
            response.body = { variables: await this.expandRef(args.variablesReference) };
        } else {
            response.body = { variables: [] };
        }
        this.sendResponse(response);
    }

    /** Allocate a variablesReference for an expandable aggregate at an address. */
    private aggRef(addr: number, node: AggNode): number {
        const ref = this.nextVarRef++;
        this.varRefs.set(ref, { addr, node });
        return ref;
    }

    /** A DAP variable for a value of `node` at `addr`: a leaf for scalars (reads
     *  memory now), or an expandable node (struct/array) with a child ref. */
    private async makeVar(name: string, addr: number, node: AggNode): Promise<DebugProtocol.Variable> {
        if (node.kind === 'scalar') {
            let bytes: number[] = [];
            try {
                bytes = await this.mcp.peekMemory(0, addr & 0xFFFF, node.size);
            } catch { /* unreadable */ }
            return formatLocal({ name, cls: node.cls, size: node.size, offset: 0 }, bytes);
        }
        const ref = this.aggRef(addr, node);
        const value = node.kind === 'array' ? `${node.count} elem[]` : `{…} ${node.size}B`;
        const type = node.kind === 'array' ? `array[${node.count}]` : `struct(${node.size}B)`;
        return { name, value, type, variablesReference: ref };
    }

    /** Expand a struct into its fields or an array into its elements. */
    private async expandRef(ref: number): Promise<DebugProtocol.Variable[]> {
        const e = this.varRefs.get(ref);
        if (!e) {
            return [];
        }
        const out: DebugProtocol.Variable[] = [];
        for (const c of aggChildren(e.node, e.addr)) {
            out.push(await this.makeVar(c.name, c.addr, c.node));
        }
        return out;
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
            const addr = (base + loc.offset) & 0xFFFF;
            const node = this.aggregates.get(`${fn} ${loc.name}`);
            if (node && node.kind !== 'scalar') {
                out.push(await this.makeVar(loc.name, addr, node)); // expandable struct/array
                continue;
            }
            try {
                const bytes = await this.mcp.peekMemory(0, addr, loc.size);
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

    /** Mirror the DAP breakpoints (PC + data) into luna's breakpoint registry
     *  (luna ≥ v1.6.0), so ONE `run_until_break` honours all of them natively. */
    private async syncLunaBreakpoints(): Promise<void> {
        await this.mcp.bpClearAll();
        for (const pc of this.pcBreakpoints()) {
            await this.mcp.bpAdd({ kind: 'exec', addr: pc });
        }
        for (const d of this.dataBreakpoints) {
            await this.mcp.bpAdd({
                kind: 'mem',
                addr: d.addr,
                onRead: d.access === 'read' || d.access === 'readWrite',
                onWrite: d.access !== 'read',
            });
        }
    }

    /**
     * Run at full speed to the first breakpoint that fires — PC breakpoints and
     * data watchpoints together, natively (`bp_add` registry + `run_until_break`).
     * Exec breakpoints halt BEFORE their instruction and the run's first
     * instruction is exempt, so resuming from a breakpoint doesn't re-trigger it.
     */
    private async runToBreakpoints(response: DebugProtocol.Response): Promise<void> {
        response.body = { ...(response.body ?? {}), allThreadsContinued: true };
        this.sendResponse(response);

        let reason = 'pause';
        try {
            if (this.pcBreakpoints().length || this.dataBreakpoints.length) {
                await this.syncLunaBreakpoints();
                const r = await this.mcp.runUntilBreak(this.maxSteps);
                if (r.hit) {
                    reason = r.kind === 'exec' ? 'breakpoint' : 'data breakpoint';
                    if (r.kind !== 'exec') {
                        const at = r.addr !== undefined ? `$${r.addr.toString(16).toUpperCase().padStart(6, '0')}` : '?';
                        const val = r.value !== undefined ? ` = ${r.value}` : '';
                        this.sendEvent(new OutputEvent(`watchpoint: ${r.kind} ${at}${val} (PC $${(r.pc ?? 0).toString(16).toUpperCase().padStart(6, '0')})\n`, 'console'));
                    }
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
        if (command === 'cooperDisasm') {
            const a = (args ?? {}) as { addr?: number; lines?: number };
            try {
                const r = await this.mcp.disasmCpu({ addr: a.addr, lines: a.lines ?? 48 });
                response.body = { lines: r.lines };
                this.sendResponse(response);
            } catch (e) {
                this.sendErrorResponse(response, 3010, `disasm failed: ${(e as Error).message}`);
            }
            return;
        }
        if (command === 'cooperMemTrace') {
            const a = (args ?? {}) as { expr?: string };
            const addr = this.sym ? resolveExpr(this.sym, a.expr ?? '') : parseAddress(a.expr ?? '');
            if (addr === undefined) {
                this.sendErrorResponse(response, 3011, `cannot resolve '${a.expr}' to an address`);
                return;
            }
            try {
                // Record every access to that exact bus address over ONE frame.
                await this.mcp.enableMemTrace({ maxEvents: 1024, bank: (addr >> 16) & 0xFF, lo: addr & 0xFFFF, hi: addr & 0xFFFF });
                await this.mcp.stepUntilFrame(2_000_000);
                const t = await this.mcp.takeMemTrace();
                // luna also records NMI/IRQ signal markers for context — keep only
                // the actual bus accesses to the watched address.
                const events = t.events.filter((ev) => ev.kind === 'read' || ev.kind === 'write').map((ev) => ({
                    ...ev,
                    // "who accessed" = the instruction's function, from Cooper's .sym
                    pcSymbol: this.sym ? (addrToSymbol(this.sym, ev.pc)?.name ?? null) : null,
                }));
                response.body = { addr, events };
                this.sendResponse(response);
                // The machine advanced a frame — refresh the UI at the new stop.
                this.sendEvent(new StoppedEvent('trace', THREAD_ID));
            } catch (e) {
                this.sendErrorResponse(response, 3012, `mem trace failed: ${(e as Error).message}`);
            }
            return;
        }
        if (command === 'cooperReplay') {
            const a = (args ?? {}) as { script?: string; extraFrames?: number };
            try {
                const checkpoints = parseInputScript(a.script ?? '');
                if (!checkpoints.length) {
                    this.sendErrorResponse(response, 3013, 'empty input script');
                    return;
                }
                // Deterministic like `luna --input`: replay from power-on, a
                // checkpoint's mask holds until the next one.
                await this.mcp.reset();
                for (const c of checkpoints) {
                    while (await this.mcp.frameCount() < c.frame) {
                        await this.mcp.stepUntilFrame(2_000_000);
                    }
                    await this.mcp.setJoypad(0, c.mask);
                    this.sendEvent(new OutputEvent(`replay: frame ${c.frame} → ${maskToButtons(c.mask)}\n`, 'console'));
                }
                for (let i = 0; i < (a.extraFrames ?? 2); i++) {
                    await this.mcp.stepUntilFrame(2_000_000); // let the last input land
                }
                response.body = { frames: await this.mcp.frameCount() };
                this.sendResponse(response);
                this.sendEvent(new StoppedEvent('replay', THREAD_ID));
            } catch (e) {
                this.sendErrorResponse(response, 3014, `replay failed: ${(e as Error).message}`);
            }
            return;
        }
        if (command === 'cooperSaveState') {
            try {
                const s = await this.mcp.saveState();
                response.body = { stateBase64: s.state_base64, bytes: s.bytes };
                this.sendResponse(response);
            } catch (e) {
                this.sendErrorResponse(response, 3008, `save_state failed: ${(e as Error).message}`);
            }
            return;
        }
        if (command === 'cooperLoadState') {
            const a = (args ?? {}) as { stateBase64?: string };
            try {
                await this.mcp.loadState(a.stateBase64 ?? '');
                this.sendResponse(response);
                // The machine jumped to the snapshot: stop so the UI re-reads
                // registers/variables/stack at the restored point.
                this.sendEvent(new StoppedEvent('restore', THREAD_ID));
            } catch (e) {
                this.sendErrorResponse(response, 3009, `load_state failed: ${(e as Error).message}`);
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
