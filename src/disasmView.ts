// Pure HTML renderer for the disassembly viewer — no `vscode` import, so it is
// Node-testable. Lines come from luna's `disasm_cpu` (symbol-annotated when a
// `.sym` is loaded); the live-PC line is highlighted.

import { DisasmLine } from './lunaMcp';

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0');

/** `$BB:AAAA` from a 24-bit bus address. */
export function formatDisasmAddr(addr: number): string {
    return `$${hex((addr >> 16) & 0xFF, 2)}:${hex(addr & 0xFFFF, 4)}`;
}

/**
 * Render luna's disassembly as a self-contained webview document. Static markup
 * only (no scripts) — pair with `enableScripts: false`.
 */
export function renderDisasmHtml(lines: DisasmLine[], cspSource: string): string {
    const rows = lines.map((l) => {
        const bytes = l.bytes.map((b) => hex(b, 2)).join(' ');
        const sym = l.symbol ? `<td class="sym">${escapeHtml(l.symbol)}</td>` : '<td class="sym"></td>';
        return `<tr class="${l.is_pc ? 'pc' : ''}"><td class="addr">${formatDisasmAddr(l.addr)}</td>` +
            `<td class="bytes">${bytes}</td><td class="text">${escapeHtml(l.text)}</td>${sym}</tr>`;
    }).join('');
    const pcLine = lines.find((l) => l.is_pc);
    const title = pcLine ? `Disassembly — PC ${formatDisasmAddr(pcLine.addr)}` : 'Disassembly';
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-editor-font-family, monospace); padding: 8px; font-size: 12px; }
  h3 { font-family: var(--vscode-font-family, sans-serif); margin: 0 0 8px; font-size: 13px; }
  table { border-collapse: collapse; white-space: pre; }
  td { padding: 0 12px 0 0; }
  .addr { color: var(--vscode-descriptionForeground); }
  .bytes { color: var(--vscode-descriptionForeground); opacity: 0.8; }
  .sym { color: var(--vscode-textLink-foreground); }
  tr.pc { background: var(--vscode-editor-lineHighlightBackground, #8882); font-weight: 700; }
  tr.pc .addr::before { content: '▶ '; }
</style></head><body>
<h3>${title}</h3>
<table><tbody>${rows}</tbody></table>
</body></html>`;
}
