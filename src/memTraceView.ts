// Pure HTML renderer for the memory-trace viewer ("who accesses this address?")
// — no `vscode` import, Node-testable. Events come from luna's mem trace over
// one frame, PC-annotated with the project's symbols by the debug adapter.

import { MemTraceEvent } from './lunaMcp';
import { formatDisasmAddr } from './disasmView';

export type TracedEvent = MemTraceEvent & { pcSymbol?: string | null };

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

/**
 * Render one frame's accesses to a watched address. Static markup (no scripts)
 * — pair with `enableScripts: false`.
 */
export function renderMemTraceHtml(expr: string, addr: number, events: TracedEvent[], cspSource: string): string {
    const rows = events.map((ev, i) => {
        const who = ev.pcSymbol ? escapeHtml(ev.pcSymbol) : '';
        const when = `${ev.line}${ev.blank ? ' (vblank)' : ''}`;
        return `<tr class="${ev.kind}"><td>${i + 1}</td><td>${ev.kind}</td>` +
            `<td class="val">$${ev.value.toString(16).toUpperCase().padStart(2, '0')}</td>` +
            `<td class="addr">${formatDisasmAddr(ev.pc)}</td><td class="sym">${who}</td><td>${when}</td></tr>`;
    }).join('');
    const empty = '<p class="none">No access to that address this frame.</p>';
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 8px; font-size: 12px; }
  h3 { margin: 0 0 2px; font-size: 13px; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
  table { border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); }
  th, td { padding: 1px 10px; text-align: left; }
  th { border-bottom: 1px solid #8884; font-family: var(--vscode-font-family, sans-serif); }
  tr.write .val { color: var(--vscode-errorForeground, #f66); font-weight: 700; }
  .addr { color: var(--vscode-descriptionForeground); }
  .sym { color: var(--vscode-textLink-foreground); }
  .none { color: var(--vscode-descriptionForeground); }
</style></head><body>
<h3>Accesses to ${escapeHtml(expr)} (${formatDisasmAddr(addr)}) — one frame</h3>
<p class="sub">${events.length} event(s) · the machine advanced one frame · watch is bank-exact (mirrors not folded)</p>
${events.length ? `<table><thead><tr><th>#</th><th>Kind</th><th>Value</th><th>PC</th><th>Function</th><th>Scanline</th></tr></thead>
<tbody>${rows}</tbody></table>` : empty}
</body></html>`;
}
