// Pure PPU decode + viewer rendering — no `vscode` import, Node-testable.
// Grounded: luna `state.ppu.cgram` is a list of 256 already-assembled 15-bit
// BGR555 colour words (NOT raw bytes); index 1 = 32767 = white.

export interface Rgb { r: number; g: number; b: number; }

/** Expand a 5-bit channel (0..31) to 8-bit (0..255), replicating high bits. */
function chan5to8(v: number): number {
    const v5 = v & 0x1f;
    return (v5 << 3) | (v5 >> 2);
}

/** Decode a 15-bit SNES BGR555 colour word (`0bBBBBBGGGGGRRRRR`) to RGB-8. */
export function bgr555ToRgb(word: number): Rgb {
    return {
        r: chan5to8(word),
        g: chan5to8(word >> 5),
        b: chan5to8(word >> 10),
    };
}

/** Decode a CGRAM snapshot (256 BGR555 words) to 256 RGB colours. */
export function decodeCgram(cgram: number[]): Rgb[] {
    return cgram.map(bgr555ToRgb);
}

/** `#RRGGBB` for an RGB colour. */
export function rgbHex(c: Rgb): string {
    const h = (n: number) => (n & 0xff).toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/**
 * Render the CGRAM palette as a self-contained webview HTML document: a 16×16
 * grid of swatches (256 colours = 16 sub-palettes of 16). `cspSource` is the
 * webview's `cspSource` for the Content-Security-Policy.
 */
export function renderPaletteHtml(colors: Rgb[], cspSource: string, title = 'CGRAM Palette'): string {
    const swatches = colors.map((c, i) => {
        const hex = rgbHex(c);
        return `<div class="sw" title="${i} (pal ${i >> 4}, idx ${i & 0xf}) ${hex}" style="background:${hex}"></div>`;
    }).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 8px; }
  h3 { margin: 0 0 8px; font-size: 13px; }
  .grid { display: grid; grid-template-columns: repeat(16, 1fr); gap: 2px; max-width: 420px; }
  .sw { aspect-ratio: 1; border: 1px solid #0004; border-radius: 2px; }
</style></head><body>
<h3>${title} — 256 colours (16×16)</h3>
<div class="grid">${swatches}</div>
</body></html>`;
}
