// Pure frame-profiler aggregation + rendering — no `vscode` import.
//
// Input: luna's per-INSTRUCTION cpu-trace events ({mclk, pc, symbol?}, symbol
// = nearest label, `name` or `name+0xNN`, annotated by luna once the `.sym` is
// loaded). An instruction's cost = the mclk delta to the next event; costs are
// grouped by the symbol's base name ("who burns my cycles?") and bucketed by
// scanline (1364 master clocks each) for the "when in the frame?" strip.

export interface TraceEvent { mclk: number; pc: number; symbol?: string | null; }

export interface ProfileRow { name: string; cycles: number; instructions: number; pct: number; }

export interface FrameProfile {
    rows: ProfileRow[];
    totalCycles: number;
    totalInstructions: number;
    /** Non-idle master clocks per 1364-mclk scanline bucket. */
    scanlines: number[];
}

export const MCLK_PER_SCANLINE = 1364;

/** Base label of a luna `symbol` annotation (`enemies_update+0x12` → `enemies_update`). */
export function baseSymbol(symbol: string | null | undefined): string {
    if (!symbol) {
        return '(no symbol)';
    }
    const plus = symbol.indexOf('+');
    return plus > 0 ? symbol.slice(0, plus) : symbol;
}

/** Aggregate one frame's trace. `frameEndMclk` bounds the last instruction's cost. */
export function aggregateProfile(events: TraceEvent[], frameEndMclk?: number): FrameProfile {
    const byName = new Map<string, { cycles: number; instructions: number }>();
    let total = 0;
    const startMclk = events.length ? events[0].mclk : 0;
    const endMclk = frameEndMclk ?? (events.length ? events[events.length - 1].mclk : 0);
    const scanlines: number[] = new Array(Math.max(1, Math.ceil((endMclk - startMclk) / MCLK_PER_SCANLINE))).fill(0);
    for (let i = 0; i < events.length; i++) {
        const cost = (i + 1 < events.length ? events[i + 1].mclk : endMclk) - events[i].mclk;
        if (cost <= 0) {
            continue;
        }
        const name = baseSymbol(events[i].symbol);
        const agg = byName.get(name) ?? { cycles: 0, instructions: 0 };
        agg.cycles += cost;
        agg.instructions++;
        byName.set(name, agg);
        total += cost;
        const bucket = Math.floor((events[i].mclk - startMclk) / MCLK_PER_SCANLINE);
        if (bucket >= 0 && bucket < scanlines.length) {
            scanlines[bucket] += cost;
        }
    }
    const rows = [...byName.entries()]
        .map(([name, a]) => ({ name, cycles: a.cycles, instructions: a.instructions, pct: total ? (a.cycles / total) * 100 : 0 }))
        .sort((a, b) => b.cycles - a.cycles);
    return { rows, totalCycles: total, totalInstructions: events.length, scanlines };
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

/** Render the profile (static — pair with `enableScripts: false`). */
export function renderProfileHtml(p: FrameProfile, cspSource: string, topN = 25): string {
    const maxCycles = p.rows[0]?.cycles ?? 1;
    const rows = p.rows.slice(0, topN).map((r) => {
        const w = Math.max(1, Math.round((r.cycles / maxCycles) * 260));
        return `<tr><td class="sym">${escapeHtml(r.name)}</td><td class="num">${r.cycles.toLocaleString('en-US')}</td>` +
            `<td class="num">${r.instructions.toLocaleString('en-US')}</td><td class="num">${r.pct.toFixed(1)}%</td>` +
            `<td class="bar"><div style="width:${w}px"></div></td></tr>`;
    }).join('');
    const maxLine = Math.max(1, ...p.scanlines);
    const strip = p.scanlines.map((c, i) =>
        `<div class="cell" style="opacity:${(0.12 + 0.88 * (c / maxLine)).toFixed(2)}" title="scanline ${i}: ${c} mclk"></div>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 10px; font-size: 12px; }
  h3 { margin: 0 0 2px; font-size: 13px; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 10px; }
  table { border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); }
  th, td { padding: 1px 12px 1px 0; text-align: left; }
  th { font-family: var(--vscode-font-family, sans-serif); border-bottom: 1px solid #8884; }
  .sym { color: var(--vscode-textLink-foreground); }
  .num { text-align: right; }
  .bar div { height: 9px; background: var(--vscode-charts-orange, #e8a04c); border-radius: 2px; }
  .strip { display: flex; gap: 1px; margin-top: 4px; flex-wrap: wrap; }
  .cell { width: 4px; height: 18px; background: var(--vscode-charts-red, #e05252); }
</style></head><body>
<h3>Frame profile — ${p.totalCycles.toLocaleString('en-US')} master clocks · ${p.totalInstructions.toLocaleString('en-US')} instructions</h3>
<p class="sub">cost per function (instruction mclk deltas, grouped by nearest symbol)</p>
<table><thead><tr><th>function</th><th>mclk</th><th>instr</th><th>%</th><th></th></tr></thead><tbody>${rows}</tbody></table>
<h3 style="margin-top:14px">When in the frame?</h3>
<p class="sub">one cell per scanline (${MCLK_PER_SCANLINE} mclk) — darker = busier</p>
<div class="strip">${strip}</div>
</body></html>`;
}
