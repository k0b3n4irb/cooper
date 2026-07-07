// Pure "where did my memory go?" map — no `vscode` import, Node-testable.
//
// WRAM side: exact blocks from the `.sym` `[ramsections]` (name/addr/SIZE from
// the linker — not a heuristic), with the labels falling inside each block as
// variable-level detail (label size = gap to the next label, bounded by the
// block end). Low-RAM mirror addresses ($00–$3F/$80–$BF banks, offset <$2000)
// are canonicalized to $7E, and blocks describing the same physical bytes
// (e.g. `.reserved_7e_mirror` @ 00:0300 vs `.oam_buffer` @ 7e:0300) merge into
// one entry so totals never double-count.
//
// VRAM side: a 64×1 KB occupancy heatmap computed from the full VRAM snapshot.

import { SymTable } from './sym';

export interface WramLabel { name: string; addr: number; size: number; }
export interface WramBlock { names: string[]; addr: number; size: number; labels: WramLabel[]; }
export interface WramMap { blocks: WramBlock[]; totalReserved: number; }

const WRAM_TOTAL = 0x20000; // 128 KB ($7E:0000–$7F:FFFF)

/** Canonical 17-bit WRAM offset for an address, or null if not WRAM. */
export function canonicalWram(addr: number): number | null {
    const bank = (addr >> 16) & 0xFF;
    const off = addr & 0xFFFF;
    if (bank === 0x7E) {
        return off;
    }
    if (bank === 0x7F) {
        return 0x10000 + off;
    }
    // low-RAM mirror in the system banks
    if (((bank <= 0x3F) || (bank >= 0x80 && bank <= 0xBF)) && off < 0x2000) {
        return off;
    }
    return null;
}

/** Build the WRAM map from the `.sym`: merged ramsection blocks + inner labels. */
export function wramMap(sym: SymTable): WramMap {
    // merge ramsections describing the same physical bytes (mirror aliases)
    const byExtent = new Map<string, WramBlock>();
    for (const s of sym.sections) {
        if (s.kind !== 'ram') {
            continue;
        }
        const canon = canonicalWram((s.bank << 16) | s.offset);
        if (canon === null || s.size <= 0) {
            continue;
        }
        const key = `${canon}+${s.size}`;
        const b = byExtent.get(key);
        if (b) {
            b.names.push(s.name);
        } else {
            byExtent.set(key, { names: [s.name], addr: canon, size: s.size, labels: [] });
        }
    }
    const blocks = [...byExtent.values()].sort((a, b) => a.addr - b.addr || b.size - a.size);

    // attach WRAM labels to their block; label size = gap to the next label
    const wramLabels = sym.labels
        .map((l) => ({ name: l.name, canon: canonicalWram(l.addr) }))
        .filter((l): l is { name: string; canon: number } => l.canon !== null)
        .sort((a, b) => a.canon - b.canon);
    for (let i = 0; i < wramLabels.length; i++) {
        const l = wramLabels[i];
        const block = blocks.find((b) => l.canon >= b.addr && l.canon < b.addr + b.size);
        if (!block) {
            continue;
        }
        const blockEnd = block.addr + block.size;
        const next = wramLabels.slice(i + 1).find((n) => n.canon > l.canon && n.canon < blockEnd);
        block.labels.push({ name: l.name, addr: l.canon, size: (next ? next.canon : blockEnd) - l.canon });
    }
    const totalReserved = blocks.reduce((n, b) => n + b.size, 0);
    return { blocks, totalReserved };
}

/** Per-1KB non-zero byte counts over a full 64 KB VRAM snapshot (64 buckets). */
export function vramHeat(vram: number[]): number[] {
    const heat = new Array(64).fill(0);
    for (let i = 0; i < Math.min(vram.length, 0x10000); i++) {
        if (vram[i] !== 0) {
            heat[i >> 10]++;
        }
    }
    return heat;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

const hexW = (n: number): string => `$7E:${(n & 0xFFFF).toString(16).toUpperCase().padStart(4, '0')}`
    .replace('$7E:', n >= 0x10000 ? '$7F:' : '$7E:');
const kb = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(n % 1024 ? 1 : 0)} KB` : `${n} B`);

/** Render the memory map (static markup — pair with `enableScripts: false`). */
export function renderMemoryMapHtml(map: WramMap, vram: number[], cspSource: string): string {
    const rows = map.blocks.map((b) => {
        const pct = Math.max(1, Math.round((b.size / WRAM_TOTAL) * 400));
        const inner = b.labels.map((l) =>
            `<tr class="lbl"><td></td><td>${hexW(l.addr)}</td><td>${escapeHtml(l.name)}</td><td>${kb(l.size)}</td><td></td></tr>`).join('');
        return `<tr><td class="bar"><div style="width:${pct}px"></div></td><td>${hexW(b.addr)}</td>` +
            `<td class="sec">${b.names.map(escapeHtml).join(' = ')}</td><td>${kb(b.size)}</td><td>${b.labels.length ? `${b.labels.length} vars` : ''}</td></tr>${inner}`;
    }).join('');
    const heat = vramHeat(vram);
    const totalVram = heat.reduce((a, b) => a + b, 0);
    const cells = heat.map((n, i) => {
        const alpha = n === 0 ? 0.06 : 0.25 + 0.75 * (n / 1024);
        return `<div class="cell" style="opacity:${alpha.toFixed(2)}" title="$${(i << 10).toString(16).toUpperCase().padStart(4, '0')}: ${n}/1024 bytes"></div>`;
    }).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 10px; font-size: 12px; }
  h3 { margin: 14px 0 6px; font-size: 13px; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 8px; }
  table { border-collapse: collapse; font-family: var(--vscode-editor-font-family, monospace); }
  td { padding: 1px 10px 1px 0; white-space: nowrap; }
  .sec { color: var(--vscode-textLink-foreground); font-weight: 600; }
  tr.lbl td { color: var(--vscode-descriptionForeground); }
  .bar div { height: 9px; background: var(--vscode-charts-blue, #4f9cf0); border-radius: 2px; }
  .grid { display: grid; grid-template-columns: repeat(16, 22px); gap: 2px; }
  .cell { height: 16px; background: var(--vscode-charts-green, #6cc26c); border-radius: 2px; }
</style></head><body>
<h3>WRAM — ${kb(map.totalReserved)} reserved of 128 KB</h3>
<p class="sub">from the linker's ramsections (exact sizes); mirror aliases merged</p>
<table><tbody>${rows || '<tr><td>no ramsections in the .sym — build the project first</td></tr>'}</tbody></table>
<h3>VRAM — ${kb(totalVram)} non-zero of 64 KB</h3>
<p class="sub">1 KB per cell, row = 16 KB · hover for the address</p>
<div class="grid">${cells}</div>
</body></html>`;
}
