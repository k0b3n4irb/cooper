// Pure interactive VRAM-viewer document — no `vscode` import, Node-testable.
//
// Renders a 16 KB window of VRAM as a tile sheet with hardware-exact controls:
// bpp (2/4/8 — the SNES planar formats), window offset into the 64 KB VRAM,
// and sub-palette (CGRAM groups of 2^bpp colours: 64×4 in 2bpp, 16×16 in 4bpp,
// 1×256 in 8bpp). The controls post `{command:'vramOpts', …}` back to the
// extension, which re-renders from its cached VRAM/CGRAM snapshot — no luna
// round-trip per tweak; `{command:'vramRefresh'}` re-reads the machine.

import { decodeTileSheet, tilesToRgba, encodePng, bytesPerTile } from './tiles';
import { decodeCgram } from './ppu';

export interface VramViewOpts {
    bpp: 2 | 4 | 8;
    /** Byte offset of the 16 KB window into the 64 KB VRAM (0x0000..0xC000). */
    offset: number;
    /** Sub-palette index (group of 2^bpp CGRAM colours). */
    subpal: number;
}

export const VRAM_WINDOW = 0x4000;
export const DEFAULT_VRAM_OPTS: VramViewOpts = { bpp: 4, offset: 0, subpal: 0 };

/** Number of sub-palettes for a bpp (CGRAM 256 colours / 2^bpp per group). */
export function subpalCount(bpp: number): number {
    return Math.max(1, 256 >> bpp);
}

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** Render the interactive VRAM viewer from a full VRAM+CGRAM snapshot. */
export function renderVramViewHtml(vram: number[], cgram: number[], opts: VramViewOpts, cspSource: string, nonce: string): string {
    const window = vram.slice(opts.offset, opts.offset + VRAM_WINDOW);
    const count = Math.floor(window.length / bytesPerTile(opts.bpp));
    const tiles = decodeTileSheet(window, opts.bpp, count);
    const groupSize = 1 << opts.bpp;
    const subpal = Math.min(opts.subpal, subpalCount(opts.bpp) - 1);
    const palette = decodeCgram(cgram).slice(subpal * groupSize, (subpal + 1) * groupSize);
    const rgba = tilesToRgba(tiles, palette, 16);
    const png = encodePng(rgba.width, rgba.height, rgba.data).toString('base64');

    const opt = (v: number, cur: number, label: string) => `<option value="${v}"${v === cur ? ' selected' : ''}>${label}</option>`;
    const offsets = [];
    for (let o = 0; o <= 0x10000 - VRAM_WINDOW; o += 0x1000) {
        offsets.push(opt(o, opts.offset, hex4(o)));
    }
    const subpals = [];
    for (let s = 0; s < subpalCount(opts.bpp); s++) {
        subpals.push(opt(s, subpal, String(s)));
    }
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 8px; font-size: 12px; }
  .bar { display: flex; gap: 14px; align-items: center; margin-bottom: 8px; flex-wrap: wrap; }
  label { color: var(--vscode-descriptionForeground); }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground);
           border: 1px solid var(--vscode-dropdown-border); border-radius: 2px; }
  button { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground);
           border: none; border-radius: 2px; padding: 2px 10px; cursor: pointer; }
  img { image-rendering: pixelated; border: 1px solid #8884; }
  .info { color: var(--vscode-descriptionForeground); margin-top: 6px; }
</style></head><body>
<div class="bar">
  <label>bpp <select id="bpp">${opt(2, opts.bpp, '2 (4 colours)')}${opt(4, opts.bpp, '4 (16 colours)')}${opt(8, opts.bpp, '8 (256 colours)')}</select></label>
  <label>offset <select id="offset">${offsets.join('')}</select></label>
  <label>sub-palette <select id="subpal">${subpals.join('')}</select></label>
  <button id="refresh">↻ Re-read VRAM</button>
</div>
<img src="data:image/png;base64,${png}" width="${rgba.width * 3}" alt="VRAM tiles"/>
<div class="info">${count} tiles · window ${hex4(opts.offset)}–${hex4(opts.offset + VRAM_WINDOW - 1)} · ${opts.bpp}bpp · sub-palette ${subpal}/${subpalCount(opts.bpp) - 1}</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const post = () => vscode.postMessage({ command: 'vramOpts',
    bpp: Number(document.getElementById('bpp').value),
    offset: Number(document.getElementById('offset').value),
    subpal: Number(document.getElementById('subpal').value) });
  for (const id of ['bpp', 'offset', 'subpal']) {
    document.getElementById(id).addEventListener('change', post);
  }
  document.getElementById('refresh').addEventListener('click', () => vscode.postMessage({ command: 'vramRefresh' }));
</script>
</body></html>`;
}
