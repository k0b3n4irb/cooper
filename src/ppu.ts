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

export interface Sprite {
    index: number;
    x: number;      // 9-bit (signed-ish; 256..511 wrap left off-screen)
    y: number;      // 8-bit; y === 240 is the SDK's "hidden" convention
    tile: number;   // 9-bit (name select bit + tile)
    palette: number; // 0..7 (sprite palettes map to CGRAM 128 + palette*16)
    priority: number; // 0..3
    hflip: boolean;
    vflip: boolean;
    sizeLarge: boolean; // OBSEL selects the two concrete sizes
    onScreen: boolean;
}

/**
 * Decode a 544-byte OAM snapshot (512-byte low table = 4 bytes × 128 sprites,
 * + 32-byte high table = 2 bits × 128: bit0 = X high, bit1 = size). Grounded on
 * aim_target (sprite 0 = the player at X=124 Y=107).
 */
export function decodeOam(oam: number[]): Sprite[] {
    const sprites: Sprite[] = [];
    for (let s = 0; s < 128; s++) {
        const o = s * 4;
        const x = oam[o] ?? 0;
        const y = oam[o + 1] ?? 0;
        const tileLo = oam[o + 2] ?? 0;
        const attr = oam[o + 3] ?? 0;
        const hi = oam[512 + (s >> 2)] ?? 0;
        const bits = (hi >> ((s & 3) * 2)) & 3;
        sprites.push({
            index: s,
            x: x | ((bits & 1) << 8),
            y,
            tile: tileLo | ((attr & 1) << 8),
            palette: (attr >> 1) & 7,
            priority: (attr >> 4) & 3,
            hflip: !!((attr >> 6) & 1),
            vflip: !!((attr >> 7) & 1),
            sizeLarge: !!((bits >> 1) & 1),
            onScreen: y !== 240,
        });
    }
    return sprites;
}

/** Render the OAM as a webview table (on-screen sprites highlighted). */
export function renderOamHtml(sprites: Sprite[], cspSource: string): string {
    const onScreen = sprites.filter((s) => s.onScreen).length;
    const rows = sprites.map((s) => {
        const flip = `${s.hflip ? 'H' : '·'}${s.vflip ? 'V' : '·'}`;
        return `<tr class="${s.onScreen ? 'on' : 'off'}"><td>${s.index}</td><td>${s.x}</td><td>${s.y}</td>` +
            `<td>${s.tile}</td><td>${s.palette}</td><td>${s.priority}</td><td>${flip}</td>` +
            `<td>${s.sizeLarge ? 'L' : 'S'}</td></tr>`;
    }).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 8px; font-size: 12px; }
  h3 { margin: 0 0 8px; font-size: 13px; }
  table { border-collapse: collapse; }
  th, td { padding: 1px 8px; text-align: right; }
  th { border-bottom: 1px solid #8884; }
  tr.off { opacity: 0.4; }
  tr.on { font-weight: 600; }
</style></head><body>
<h3>OAM — ${onScreen} on-screen of 128 sprites</h3>
<table><thead><tr><th>#</th><th>X</th><th>Y</th><th>Tile</th><th>Pal</th><th>Pri</th><th>Flip</th><th>Sz</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
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
