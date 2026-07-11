// The OpenSNES MCP server — a hand-rolled JSON-RPC 2.0 stdio server (no
// @modelcontextprotocol/sdk dependency; same protocol the luna MCP uses, mirrored
// from lunaMcp.ts's client side). It exposes the SDK as queryable tools so an AI
// assistant can look up exact signatures / hardware rules from the *installed*
// SDK. Bundled to dist/opensnes-mcp.js and registered by the extension with the
// resolved SDK path: `node dist/opensnes-mcp.js <sdkPath>`.
//
// The dispatch (`handleMessage`) is pure and Node-tested; only stdin/stdout wiring
// lives in the `main` guard.

import * as readline from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { lookupApi, searchApi, listHeaders, hardwareConstraint, HARDWARE } from './opensnesApi';
import { resolveLunaPath } from './build';

export const TOOLS = [
    {
        name: 'build_and_run',
        description: 'Close the loop: BUILD the OpenSNES project (make) and RUN it headlessly on the luna emulator (cycle-accurate), returning build errors OR a screenshot of what it renders plus key PPU/CPU state. Use this after editing code to VERIFY it renders correctly on real hardware and self-correct. Optional `input` drives the joypad (frame:hexmask, e.g. "10:0x100,40:0").',
        inputSchema: { type: 'object', properties: { project_dir: { type: 'string', description: 'project folder (defaults to the server cwd)' }, steps: { type: 'number', description: 'CPU instructions to run before the screenshot (default 2000000 ≈ 80 frames)' }, input: { type: 'string', description: 'scripted joypad-1 input, frame:hexmask comma-separated' } } },
    },
    {
        name: 'lookup_api',
        description: 'Look up an OpenSNES SDK function or macro: returns its exact signature, header, and doc comment from the installed SDK.',
        inputSchema: { type: 'object', properties: { symbol: { type: 'string', description: 'e.g. oamSet, bgInitTileSet, OBJ_SIZE8_L32' } }, required: ['symbol'] },
    },
    {
        name: 'search_api',
        description: 'Search the OpenSNES SDK headers for declared symbols (functions/macros) matching a substring.',
        inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'e.g. oam, dma, bgInit' } }, required: ['query'] },
    },
    {
        name: 'list_headers',
        description: 'List the OpenSNES SDK headers (snes/*.h) available to include.',
        inputSchema: { type: 'object', properties: {} },
    },
    {
        name: 'hardware_constraint',
        description: `Get a SNES hardware constraint the compiler/PPU enforces (host intuition gets these wrong). Topics: ${Object.keys(HARDWARE).join(', ')}.`,
        inputSchema: { type: 'object', properties: { topic: { type: 'string', description: 'one of the topics, or omit for the index' } } },
    },
];

interface JsonRpc { jsonrpc?: string; id?: number | string | null; method?: string; params?: Record<string, unknown>; }

function toolText(sdkPath: string, name: string, args: Record<string, unknown>): { text: string; isError?: boolean } {
    switch (name) {
        case 'lookup_api': {
            const h = lookupApi(sdkPath, String(args.symbol ?? ''));
            return { text: h ? `${h.signature}\n\nHeader: ${h.header}${h.doc ? `\nDoc: ${h.doc}` : ''}` : `No API symbol "${args.symbol}" found in the SDK headers.` };
        }
        case 'search_api': {
            const r = searchApi(sdkPath, String(args.query ?? ''));
            return { text: r.length ? r.map((x) => `${x.symbol}  (${x.header})`).join('\n') : `No symbols matching "${args.query}".` };
        }
        case 'list_headers':
            return { text: listHeaders(sdkPath).map((h) => h.rel).join('\n') || 'No SDK headers found (is cooper.opensnesPath set?).' };
        case 'hardware_constraint':
            return { text: hardwareConstraint(args.topic ? String(args.topic) : undefined) };
        default:
            return { text: `Unknown tool: ${name}`, isError: true };
    }
}

/** Last `n` non-empty lines of the make output — the build errors that matter. */
export function tailLines(text: string, n: number): string {
    const lines = text.split('\n').filter((l) => l.trim());
    return lines.slice(-n).join('\n');
}

/** A compact, AI-useful summary of a luna `state` snapshot: the things you check
 *  to know "did it render". Tolerant of missing fields (shape varies by version). */
export function summarizeState(state: Record<string, unknown>): string {
    const ppu = (state.ppu ?? {}) as Record<string, unknown>;
    const cpu = (state.cpu ?? {}) as Record<string, unknown>;
    const apu = (state.apu ?? {}) as Record<string, unknown>;
    const bits: string[] = [];
    if (ppu.bg_mode !== undefined || ppu.bgmode !== undefined) {
        bits.push(`BG mode ${ppu.bg_mode ?? ppu.bgmode}`);
    }
    if (ppu.forced_blank !== undefined) {
        bits.push(ppu.forced_blank ? 'FORCED BLANK (screen off — nothing shows)' : 'screen on');
    }
    if (ppu.brightness !== undefined) {
        bits.push(`brightness ${ppu.brightness}`);
    }
    const oam = (ppu.oam_full ?? []) as number[];
    if (Array.isArray(oam) && oam.length >= 4) {
        // sprite 0 as a hint; full OAM inspection is a separate tool
        bits.push(`sprite0 @(${oam[0]},${oam[1]}) tile ${oam[2]}`);
    }
    if (typeof cpu.pc === 'number') {
        bits.push(`PC $${cpu.pc.toString(16)}`);
    }
    if (apu.active_voices !== undefined) {
        bits.push(`${apu.active_voices} audio voices`);
    }
    return bits.length ? bits.join(' · ') : '(no state fields)';
}

export interface McpContentItem { type: string; text?: string; data?: string; mimeType?: string; }
export interface ToolResult { content: McpContentItem[]; isError?: boolean; }

/**
 * The verify loop, in one call: `make` the project, then run the built ROM on luna
 * headlessly and return a screenshot (image the AI can SEE) + a state summary — or
 * the build errors. This is the C7 differentiator: "the AI verified it renders
 * right on cycle-accurate hardware." Side-effecting (spawns make + luna); the pure
 * parts (tailLines/summarizeState) are unit-tested, the whole is e2e-tested.
 */
export async function buildAndRun(sdkPath: string, args: Record<string, unknown>): Promise<ToolResult> {
    const projectDir = String(args.project_dir ?? process.cwd());
    if (!fs.existsSync(path.join(projectDir, 'Makefile'))) {
        return { content: [{ type: 'text', text: `No Makefile in ${projectDir}. Is this an OpenSNES project? (project_dir arg, or run the server from the project.)` }], isError: true };
    }
    const make = spawnSync('make', [`OPENSNES=${sdkPath}`], { cwd: projectDir, encoding: 'utf8', timeout: 180000 });
    if (make.status !== 0) {
        return { content: [{ type: 'text', text: `BUILD FAILED (make exit ${make.status}):\n${tailLines((make.stdout ?? '') + '\n' + (make.stderr ?? ''), 30)}` }], isError: true };
    }
    const rom = fs.readdirSync(projectDir).find((f) => /\.(sfc|smc)$/i.test(f));
    if (!rom) {
        return { content: [{ type: 'text', text: 'Build succeeded but produced no .sfc/.smc — check TARGET in the Makefile.' }], isError: true };
    }
    const luna = resolveLunaPath({ sdkPath });
    if (!luna) {
        return { content: [{ type: 'text', text: `BUILD OK → ${rom}. But luna was not found, so I can't run/verify it. Set cooper.lunaPath (or put luna on PATH).` }] };
    }
    const steps = Number(args.steps) > 0 ? Math.floor(Number(args.steps)) : 2_000_000;
    const png = path.join(os.tmpdir(), `cooper_verify_${process.pid}_${Date.now() % 100000}.png`);
    const lunaArgs = ['state', path.join(projectDir, rom), '-n', String(steps), '--screenshot', png];
    if (typeof args.input === 'string' && args.input.trim()) {
        lunaArgs.push('--input', args.input.trim());
    }
    const run = spawnSync(luna, lunaArgs, { encoding: 'utf8', timeout: 90000, maxBuffer: 64 * 1024 * 1024 });
    let state: Record<string, unknown> = {};
    try {
        state = JSON.parse(run.stdout ?? '{}');
    } catch { /* non-JSON (e.g. luna log noise) — summary just omits fields */ }
    const content: McpContentItem[] = [{
        type: 'text',
        text: `BUILD OK → ${rom}. Ran ${steps.toLocaleString()} instructions on luna.\nState: ${summarizeState(state)}\n(Below is the framebuffer — check it renders what you intended.)`,
    }];
    if (fs.existsSync(png)) {
        content.push({ type: 'image', data: fs.readFileSync(png).toString('base64'), mimeType: 'image/png' });
        try { fs.unlinkSync(png); } catch { /* best effort */ }
    } else {
        content.push({ type: 'text', text: 'luna produced no screenshot (it may have crashed or hung — check the ROM boots).' });
    }
    return content.length ? { content } : { content: [{ type: 'text', text: 'ran, but no output' }] };
}

/** Tools whose handler is async + side-effecting (spawns processes); handled
 *  outside the pure `handleMessage` dispatch. */
export const ASYNC_TOOLS = new Set(['build_and_run']);

/** Pure JSON-RPC dispatch. Returns the response object, or null for notifications
 *  (no reply). `sdkPath` is the OpenSNES SDK root. */
export function handleMessage(sdkPath: string, msg: JsonRpc): object | null {
    const { id, method, params } = msg;
    const ok = (result: object): object => ({ jsonrpc: '2.0', id, result });
    switch (method) {
        case 'initialize':
            return ok({ protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'opensnes', version: '0.1.0' } });
        case 'notifications/initialized':
        case 'initialized':
            return null; // notification — no response
        case 'ping':
            return ok({});
        case 'tools/list':
            return ok({ tools: TOOLS });
        case 'tools/call': {
            const name = String(params?.name ?? '');
            const args = (params?.arguments as Record<string, unknown>) ?? {};
            let r: { text: string; isError?: boolean };
            try {
                r = toolText(sdkPath, name, args);
            } catch (e) {
                r = { text: `error: ${(e as Error).message}`, isError: true };
            }
            return ok({ content: [{ type: 'text', text: r.text }], ...(r.isError ? { isError: true } : {}) });
        }
        default:
            return { jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } };
    }
}

/* c8 ignore start — stdin/stdout wiring, exercised via the real server, not units */
if (require.main === module) {
    const sdkPath = process.argv[2] || process.env.OPENSNES || '';
    const rl = readline.createInterface({ input: process.stdin, terminal: false });
    const send = (o: object): void => { process.stdout.write(JSON.stringify(o) + '\n'); };
    rl.on('line', (line) => {
        if (!line.trim()) {
            return;
        }
        let msg: JsonRpc;
        try {
            msg = JSON.parse(line);
        } catch {
            return;
        }
        // Async, side-effecting tools (build_and_run) run outside the pure dispatch.
        if (msg.method === 'tools/call' && ASYNC_TOOLS.has(String(msg.params?.name ?? ''))) {
            const args = (msg.params?.arguments as Record<string, unknown>) ?? {};
            buildAndRun(sdkPath, args)
                .then((r) => send({ jsonrpc: '2.0', id: msg.id, result: { content: r.content, ...(r.isError ? { isError: true } : {}) } }))
                .catch((e) => send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `build_and_run error: ${(e as Error).message}` }], isError: true } }));
            return;
        }
        const resp = handleMessage(sdkPath, msg);
        if (resp) {
            send(resp);
        }
    });
}
/* c8 ignore stop */
