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
import { lookupApi, searchApi, listHeaders, hardwareConstraint, HARDWARE } from './opensnesApi';

export const TOOLS = [
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
        const resp = handleMessage(sdkPath, msg);
        if (resp) {
            process.stdout.write(JSON.stringify(resp) + '\n');
        }
    });
}
/* c8 ignore stop */
