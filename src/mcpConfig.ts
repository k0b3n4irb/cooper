// Pure builders for the MCP server config files that register luna with an AI
// assistant — no `vscode` import, Node-testable. C7 part 2. Writing these files
// works on any VS Code and any assistant (unlike the extension MCP-provider API,
// which would force a much newer `engines.vscode`). Grounded (doc-researcher 2026):
//   - `.vscode/mcp.json`  → VS Code native / Copilot agent mode, key **`servers`**
//   - `.mcp.json`         → Claude Code / Cursor, key **`mcpServers`**
// Entry is a stdio server: `luna mcp`.

export interface McpStdio {
    type: 'stdio';
    command: string;
    args: string[];
}

export function lunaEntry(command: string, args: string[] = ['mcp']): McpStdio {
    return { type: 'stdio', command, args };
}

/** The OpenSNES SDK-docs + `build_and_run` verify server: `node <mcp.js> <sdk>`. */
export function opensnesEntry(mcpJsPath: string, sdkPath: string, node = 'node'): McpStdio {
    return { type: 'stdio', command: node, args: [mcpJsPath, sdkPath] };
}

/** Merge a set of named servers into a config object under `key`, preserving any
 *  existing servers. `existing` is the current file text (or null). */
function mergeInto(existing: string | null, key: 'servers' | 'mcpServers', servers: Record<string, McpStdio>): string {
    const obj = existing && existing.trim() ? JSON.parse(existing) : {};
    obj[key] = (obj[key] && typeof obj[key] === 'object') ? obj[key] : {};
    Object.assign(obj[key], servers);
    return JSON.stringify(obj, null, 2) + '\n';
}

/** `.vscode/mcp.json` (key `servers`) for VS Code / Copilot. Throws on invalid
 *  JSON (caller handles JSONC/comments). */
export function mergeVscodeMcp(existing: string | null, servers: Record<string, McpStdio>): string {
    return mergeInto(existing, 'servers', servers);
}

/** `.mcp.json` (key `mcpServers`) for Claude Code / Cursor. */
export function mergeProjectMcp(existing: string | null, servers: Record<string, McpStdio>): string {
    return mergeInto(existing, 'mcpServers', servers);
}
