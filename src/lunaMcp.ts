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
    serverInfo: { name?: string; version?: string } = {};

    constructor(opts: { timeoutMs?: number } = {}) {
        this.defaultTimeout = opts.timeoutMs ?? 30000;
    }

    /** Spawn `luna mcp` and complete the MCP initialize handshake. */
    async connect(lunaPath: string, cwd?: string): Promise<void> {
        const proc = spawn(lunaPath, ['mcp'], { cwd, stdio: ['pipe', 'pipe', 'ignore'] });
        this.proc = proc;
        proc.stdout!.setEncoding('utf8');
        proc.stdout!.on('data', (chunk: string) => this.onData(chunk));
        proc.on('exit', () => this.failAll(new Error('luna mcp exited')));
        proc.on('error', (e) => this.failAll(e));

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
