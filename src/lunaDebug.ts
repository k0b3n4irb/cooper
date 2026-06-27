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
    OutputEvent, Thread, StackFrame, Scope,
} from '@vscode/debugadapter';
import { DebugProtocol } from '@vscode/debugprotocol';
import * as path from 'path';
import * as fs from 'fs';
import { LunaMcp, CpuState } from './lunaMcp';
import { parseSym, SymTable, symbolToAddr, addrToSymbol, formatResolved, resolveExpr, parseAddress } from './sym';

const THREAD_ID = 1;
const REGISTERS_REF = 1000;

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

export class LunaDebugSession extends LoggingDebugSession {
    private mcp = new LunaMcp();
    private sym: SymTable | null = null;
    private breakpoints: number[] = [];      // 24-bit PC addresses
    private configurationDone = false;
    private stopOnEntry = true;
    private maxSteps = 5_000_000;

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
        response.body.supportsRestartRequest = false;
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
        // Load the sibling `.sym` for symbol resolution (best-effort).
        const symPath = args.program.replace(/\.(sfc|smc)$/i, '') + '.sym';
        if (fs.existsSync(symPath)) {
            this.sym = parseSym(fs.readFileSync(symPath, 'utf8'));
            this.sendEvent(new OutputEvent(`Loaded symbols: ${path.basename(symPath)} (${this.sym.labels.length} labels)\n`, 'console'));
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
        response.body = { stackFrames: [frame], totalFrames: 1 };
        this.sendResponse(response);
    }

    protected scopesRequest(response: DebugProtocol.ScopesResponse): void {
        response.body = { scopes: [new Scope('Registers', REGISTERS_REF, false)] };
        this.sendResponse(response);
    }

    protected async variablesRequest(
        response: DebugProtocol.VariablesResponse,
        args: DebugProtocol.VariablesArguments,
    ): Promise<void> {
        if (args.variablesReference === REGISTERS_REF) {
            const cpu = await this.mcp.cpu();
            response.body = { variables: formatRegisters(cpu) };
        } else {
            response.body = { variables: [] };
        }
        this.sendResponse(response);
    }

    protected async continueRequest(
        response: DebugProtocol.ContinueResponse,
        _args: DebugProtocol.ContinueArguments,
    ): Promise<void> {
        await this.runToBreakpoints(response);
    }

    /** Run to the first breakpoint (exact for one bp; chunked scan for many). */
    private async runToBreakpoints(response: DebugProtocol.Response): Promise<void> {
        response.body = { ...(response.body ?? {}), allThreadsContinued: true };
        this.sendResponse(response);

        let hit = false;
        try {
            if (this.breakpoints.length === 1) {
                hit = (await this.mcp.runUntilPc(this.breakpoints[0], this.maxSteps)).hit;
            } else if (this.breakpoints.length > 1) {
                hit = await this.scanForBreakpoints();
            } else {
                // No breakpoints: advance a bounded budget, then pause.
                await this.mcp.step(Math.min(this.maxSteps, 200000));
            }
        } catch (e) {
            this.sendEvent(new OutputEvent(`continue failed: ${(e as Error).message}\n`, 'stderr'));
            this.sendEvent(new TerminatedEvent());
            return;
        }
        this.sendEvent(new StoppedEvent(hit ? 'function breakpoint' : 'pause', THREAD_ID));
    }

    /** Chunked single-step scan for >1 breakpoint (may overshoot — D-016 gap). */
    private async scanForBreakpoints(): Promise<boolean> {
        const set = new Set(this.breakpoints);
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
        await this.stepOne(response);
    }
    protected async stepInRequest(response: DebugProtocol.StepInResponse): Promise<void> {
        await this.stepOne(response);
    }
    protected async stepOutRequest(response: DebugProtocol.StepOutResponse): Promise<void> {
        await this.stepOne(response);
    }
    /** MVP: every step variant = one instruction (no call/return semantics yet). */
    private async stepOne(response: DebugProtocol.Response): Promise<void> {
        this.sendResponse(response);
        try {
            await this.mcp.step(1);
        } catch (e) {
            this.sendEvent(new OutputEvent(`step failed: ${(e as Error).message}\n`, 'stderr'));
        }
        this.sendEvent(new StoppedEvent('step', THREAD_ID));
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

    protected disconnectRequest(response: DebugProtocol.DisconnectResponse): void {
        this.mcp.dispose();
        this.sendResponse(response);
    }
}
