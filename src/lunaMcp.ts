// Hand-rolled stdio JSON-RPC 2.0 client for `luna mcp` — no `vscode` import, so
// it is Node-testable against the real binary. Zero deps (vs the official
// @modelcontextprotocol/sdk, which pulls ~18 HTTP/OAuth deps we never use over
// stdio — see docs/DECISIONS.md D-017).
//
// Framing is NEWLINE-delimited JSON (not LSP Content-Length), confirmed live
// against the pinned binary's rmcp server. The MCP handshake is mandatory:
// initialize -> (await result) -> notifications/initialized -> tools/call.

import { spawn, ChildProcess } from 'child_process';

const PROTOCOL_VERSION = '2024-11-05';

interface Pending {
    resolve: (v: unknown) => void;
    reject: (e: Error) => void;
}

export interface MemBreakResult {
    hit: boolean;
    pc?: number;
    value?: number;
}

/** One disassembled instruction (luna `disasm_cpu`/`disasm_spc`). */
export interface DisasmLine {
    addr: number;
    bytes: number[];
    text: string;
    is_pc: boolean;
    symbol?: string | null;
}

/** One recorded bus access (luna `take_mem_trace`). */
export interface MemTraceEvent {
    mclk: number;
    pc: number;
    addr: number;
    kind: 'read' | 'write' | 'nmi' | 'irq';
    value: number;
    line: number;
    hclock: number;
    blank: boolean;
    force_blank: boolean;
    symbol?: string | null;
}

/** `run_until_break` outcome (luna ≥ v1.6.0 breakpoint registry). */
export interface BreakHit {
    steps: number;
    hit: boolean;
    bp_id?: number;
    kind?: 'exec' | 'read' | 'write';
    pc?: number;
    addr?: number;
    value?: number;
}

/** CPU register snapshot (subset of luna's `state.cpu`). */
export interface CpuState {
    a: number; x: number; y: number; sp: number;
    pc: number; pb: number; db: number; dp: number;
    p: number; e: number;
    stopped: boolean; waiting: boolean;
}

export class LunaMcp {
    private proc: ChildProcess | null = null;
    private buf = '';
    private nextId = 1;
    private readonly pending = new Map<number, Pending>();
    private readonly defaultTimeout: number;
    private readonly onLog: (line: string) => void;
    serverInfo: { name?: string; version?: string } = {};

    constructor(opts: { timeoutMs?: number; onLog?: (line: string) => void } = {}) {
        this.defaultTimeout = opts.timeoutMs ?? 30000;
        this.onLog = opts.onLog ?? (() => undefined);
    }

    /** Spawn `luna mcp` and complete the MCP initialize handshake. */
    async connect(lunaPath: string, cwd?: string): Promise<void> {
        this.onLog(`luna mcp: spawning ${lunaPath} (cwd ${cwd ?? process.cwd()})`);
        const proc = spawn(lunaPath, ['mcp'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc = proc;
        proc.stdout!.setEncoding('utf8');
        proc.stdout!.on('data', (chunk: string) => this.onData(chunk));
        // Always drain stderr (an unread pipe can block the child); surface it in the log.
        proc.stderr!.setEncoding('utf8');
        proc.stderr!.on('data', (chunk: string) => {
            for (const line of chunk.split('\n')) {
                if (line.trim()) {
                    this.onLog(`luna mcp stderr: ${line}`);
                }
            }
        });
        proc.on('exit', (code, signal) => {
            this.onLog(`luna mcp: exited (code ${code ?? '-'}, signal ${signal ?? '-'})`);
            this.failAll(new Error('luna mcp exited'));
        });
        proc.on('error', (e) => {
            this.onLog(`luna mcp: spawn error — ${e.message}`);
            this.failAll(e);
        });

        const init = await this.request('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'cooper', version: '0' },
        }) as { serverInfo?: { name?: string; version?: string } };
        this.serverInfo = init?.serverInfo ?? {};
        this.notify('notifications/initialized', {});
    }

    private onData(chunk: string): void {
        this.buf += chunk;
        let nl: number;
        while ((nl = this.buf.indexOf('\n')) >= 0) {
            const line = this.buf.slice(0, nl).trim();
            this.buf = this.buf.slice(nl + 1);
            if (line === '') {
                continue;
            }
            let msg: { id?: number; result?: unknown; error?: { message?: string } };
            try {
                msg = JSON.parse(line);
            } catch {
                continue; // ignore non-JSON lines (e.g. stray logs)
            }
            if (typeof msg.id === 'number' && this.pending.has(msg.id)) {
                const p = this.pending.get(msg.id)!;
                this.pending.delete(msg.id);
                if (msg.error) {
                    p.reject(new Error(msg.error.message ?? 'MCP error'));
                } else {
                    p.resolve(msg.result);
                }
            }
            // notifications (no id) are ignored: the pinned server pushes none we need.
        }
    }

    private failAll(err: Error): void {
        for (const p of this.pending.values()) {
            p.reject(err);
        }
        this.pending.clear();
    }

    private write(obj: unknown): void {
        if (!this.proc) {
            throw new Error('LunaMcp not connected');
        }
        this.proc.stdin!.write(JSON.stringify(obj) + '\n');
    }

    private notify(method: string, params: unknown): void {
        this.write({ jsonrpc: '2.0', method, params });
    }

    private request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
        const id = this.nextId++;
        return new Promise<unknown>((resolve, reject) => {
            const timer = setTimeout(() => {
                if (this.pending.delete(id)) {
                    this.onLog(`luna mcp: ${method} timed out after ${timeoutMs ?? this.defaultTimeout}ms`);
                    reject(new Error(`MCP ${method} timed out after ${timeoutMs ?? this.defaultTimeout}ms`));
                }
            }, timeoutMs ?? this.defaultTimeout);
            this.pending.set(id, {
                resolve: (v) => { clearTimeout(timer); resolve(v); },
                reject: (e) => { clearTimeout(timer); reject(e); },
            });
            this.write({ jsonrpc: '2.0', id, method, params });
        });
    }

    /**
     * Call an MCP tool and return its decoded JSON payload. Prefers
     * `structuredContent`; else parses the first text content block.
     */
    async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
        const res = await this.request('tools/call', { name, arguments: args }) as {
            isError?: boolean;
            structuredContent?: unknown;
            content?: Array<{ type?: string; text?: string }>;
        };
        if (res?.isError) {
            const t = (res.content ?? []).map((c) => c.text ?? '').join('');
            throw new Error(`tool ${name} failed: ${t}`);
        }
        if (res?.structuredContent !== undefined) {
            return res.structuredContent;
        }
        const text = (res?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
        try {
            return JSON.parse(text);
        } catch {
            return text;
        }
    }

    // --- typed convenience wrappers over the grounded 17-tool catalogue ---

    loadRom(romPath: string): Promise<unknown> {
        return this.callTool('load_rom', { path: romPath });
    }

    reset(): Promise<unknown> {
        return this.callTool('reset', {});
    }

    /** Full state snapshot; unwraps the `{state:{...}}` envelope if present. */
    async state(): Promise<Record<string, unknown>> {
        const s = await this.callTool('state', {}) as Record<string, unknown>;
        return (s && typeof s === 'object' && 'state' in s ? s.state : s) as Record<string, unknown>;
    }

    /** CPU registers (convenience over `state().cpu`). */
    async cpu(): Promise<CpuState> {
        const s = await this.state();
        return s.cpu as CpuState;
    }

    step(count: number): Promise<unknown> {
        return this.callTool('step', { count });
    }

    /** Run until PB:PC reaches `pc` (24-bit) or `maxSteps` elapse. */
    runUntilPc(pc: number, maxSteps: number): Promise<{ hit: boolean }> {
        return this.callTool('run_until_pc', { pc, max_steps: maxSteps }) as Promise<{ hit: boolean }>;
    }

    /** Run until an instruction WRITES the 24-bit bus address `addr`. */
    runUntilMemWrite(addr: number, maxSteps: number): Promise<MemBreakResult> {
        return this.callTool('run_until_mem_write', { addr, max_steps: maxSteps }) as Promise<MemBreakResult>;
    }

    /** Run until an instruction READS the 24-bit bus address `addr`. */
    runUntilMemRead(addr: number, maxSteps: number): Promise<MemBreakResult> {
        return this.callTool('run_until_mem_read', { addr, max_steps: maxSteps }) as Promise<MemBreakResult>;
    }

    // --- breakpoint registry (luna ≥ v1.6.0; grounded in luna-mcp-server lib.rs) ---

    /** Register a breakpoint: `exec` halts BEFORE the instruction at 24-bit PB:PC
     *  `addr` executes; `mem` is a watchpoint over `addr..=hi` (default a single
     *  address), firing on reads/writes as configured. Returns the registry id. */
    bpAdd(opts: { kind: 'exec' | 'mem'; addr: number; hi?: number; onRead?: boolean; onWrite?: boolean }): Promise<{ id: number }> {
        return this.callTool('bp_add', {
            kind: opts.kind,
            addr: opts.addr,
            ...(opts.hi !== undefined ? { hi: opts.hi } : {}),
            ...(opts.onRead !== undefined ? { on_read: opts.onRead } : {}),
            ...(opts.onWrite !== undefined ? { on_write: opts.onWrite } : {}),
        }) as Promise<{ id: number }>;
    }

    /** Remove every registered breakpoint and watchpoint. */
    bpClearAll(): Promise<unknown> {
        return this.callTool('bp_clear_all', {});
    }

    /** List the registered breakpoints/watchpoints (ordered by id). */
    bpList(): Promise<{ breakpoints: { id: number; kind: 'exec' | 'mem'; lo: number; hi: number; on_read: boolean; on_write: boolean }[] }> {
        return this.callTool('bp_list', {}) as Promise<{ breakpoints: { id: number; kind: 'exec' | 'mem'; lo: number; hi: number; on_read: boolean; on_write: boolean }[] }>;
    }

    /** Run at full speed until ANY registered breakpoint fires or `maxSteps`
     *  elapse. Exec BPs halt before their instruction (the run's first
     *  instruction is exempt, so resuming from a BP doesn't re-trigger it);
     *  watchpoints halt after the access and report its pc/addr/value. */
    runUntilBreak(maxSteps: number): Promise<BreakHit> {
        return this.callTool('run_until_break', { max_steps: maxSteps }) as Promise<BreakHit>;
    }

    // --- disassembly & symbols (luna ≥ v1.6.0) ---

    /** Disassemble CPU instructions. Defaults: start at the live PC, 16 lines,
     *  M/X widths from the live flags. `is_pc` marks the live-PC line; `symbol`
     *  annotates when a `.sym` is loaded (see `loadSymbols`). */
    disasmCpu(opts: { addr?: number; lines?: number } = {}): Promise<{ lines: DisasmLine[] }> {
        return this.callTool('disasm_cpu', {
            ...(opts.addr !== undefined ? { addr: opts.addr } : {}),
            ...(opts.lines !== undefined ? { lines: opts.lines } : {}),
        }) as Promise<{ lines: DisasmLine[] }>;
    }

    /** Load a WLA-DX `.sym` into luna so disasm/traces annotate symbols and
     *  address-taking tools accept `symbol:`. Returns the label count. */
    loadSymbols(symPath: string): Promise<{ count: number }> {
        return this.callTool('load_symbols', { path: symPath }) as Promise<{ count: number }>;
    }

    // --- memory tracing (luna ≥ v1.6.0) ---

    /** Start recording bus accesses into a capped ring, optionally filtered to a
     *  bank and an inclusive offset range. Drain with `takeMemTrace`. */
    enableMemTrace(opts: { maxEvents: number; bank?: number; lo?: number; hi?: number }): Promise<unknown> {
        return this.callTool('enable_mem_trace', {
            max_events: opts.maxEvents,
            ...(opts.bank !== undefined ? { bank: opts.bank } : {}),
            ...(opts.lo !== undefined ? { lo: opts.lo } : {}),
            ...(opts.hi !== undefined ? { hi: opts.hi } : {}),
        });
    }

    /** Drain the recorded accesses (oldest first; draining resets the ring). */
    takeMemTrace(): Promise<{ events: MemTraceEvent[] }> {
        return this.callTool('take_mem_trace', {}) as Promise<{ events: MemTraceEvent[] }>;
    }

    /** Run until the next full frame boundary (bounded by `maxSteps`). */
    stepUntilFrame(maxSteps: number): Promise<{ executed: number }> {
        return this.callTool('step_until_frame', { max_steps: maxSteps }) as Promise<{ executed: number }>;
    }

    // --- savestates (luna ≥ v1.6.0) ---

    /** Serialize the whole machine to a versioned, ROM-hash-guarded blob (base64). */
    saveState(): Promise<{ state_base64: string; bytes: number }> {
        return this.callTool('save_state', {}) as Promise<{ state_base64: string; bytes: number }>;
    }

    /** Restore a `save_state` blob. Rejected if the version or ROM hash mismatch. */
    loadState(stateBase64: string): Promise<unknown> {
        return this.callTool('load_state', { state_base64: stateBase64 });
    }

    /** Read `count` bytes from the CPU bus at `bank:offset` (returns the byte array). */
    async peekMemory(bank: number, offset: number, count: number): Promise<number[]> {
        const r = await this.callTool('peek_memory', { bank, offset, count }) as { bytes?: number[] };
        return r?.bytes ?? [];
    }

    /** Read `count` bytes from the 64 KB PPU VRAM at `offset` (returns the byte array). */
    async peekVram(offset: number, count: number): Promise<number[]> {
        const r = await this.callTool('peek_vram', { offset, count }) as { bytes?: number[] };
        return r?.bytes ?? [];
    }

    /** Terminate the luna process. */
    dispose(): void {
        if (this.proc) {
            this.failAll(new Error('disposed'));
            try {
                this.proc.stdin?.end();
            } catch { /* ignore */ }
            this.proc.kill();
            this.proc = null;
        }
    }
}
