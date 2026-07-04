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

/** Merge a `luna` server into a `.vscode/mcp.json` (key `servers`), preserving any
 *  existing servers. `existing` is the current file text (or null). Returns pretty
 *  JSON text. Throws if `existing` isn't valid JSON (caller handles JSONC/comments). */
export function mergeVscodeMcp(existing: string | null, command: string, args: string[] = ['mcp']): string {
    const obj = existing && existing.trim() ? JSON.parse(existing) : {};
    obj.servers = (obj.servers && typeof obj.servers === 'object') ? obj.servers : {};
    obj.servers.luna = lunaEntry(command, args);
    return JSON.stringify(obj, null, 2) + '\n';
}

/** Merge a `luna` server into a `.mcp.json` (key `mcpServers`) for Claude Code /
 *  Cursor, preserving existing servers. */
export function mergeProjectMcp(existing: string | null, command: string, args: string[] = ['mcp']): string {
    const obj = existing && existing.trim() ? JSON.parse(existing) : {};
    obj.mcpServers = (obj.mcpServers && typeof obj.mcpServers === 'object') ? obj.mcpServers : {};
    obj.mcpServers.luna = lunaEntry(command, args);
    return JSON.stringify(obj, null, 2) + '\n';
}
