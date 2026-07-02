// Pure HTML render for the SNES palette editor webview — no `vscode` import, so
// the markup is unit-testable. The extension glue (open PNG, save PLTE) lives in
// extension.ts. Colours are edited in the SNES-native 5-bit BGR555 space
// (channels 0..31); the client posts the edited palette back for writePalette().

import { Rgb, rgb8ToBgr555 } from './pngPalette';

/** channel 0..31 from a 15-bit BGR555 value. */
function chans(v: number): { r: number; g: number; b: number } {
    return { r: v & 31, g: (v >> 5) & 31, b: (v >> 10) & 31 };
}

/** CSS colour for a swatch (expand 5→8 the gfx4snes way). */
function css(v: number): string {
    const e = (x: number) => ((x << 3) | (x >> 2)) & 0xFF;
    const c = chans(v);
    return `rgb(${e(c.r)},${e(c.g)},${e(c.b)})`;
}

export interface PaletteEditorOpts {
    /** basename shown in the header. */
    fileName: string;
    /** colours per sub-palette row (16 for 4bpp, 4 for 2bpp, 16 for sprites). */
    perRow?: number;
    /** CGRAM base for the label (0 for BG, 128 for sprites). */
    cgramBase?: number;
}

/**
 * Render the palette editor. `palette` is the PNG's 8-bit RGB entries; each is
 * shown/edited as BGR555. Rows of `perRow` mark the SNES sub-palettes; entry 0 of
 * each row is flagged transparent. The client script owns picker + Save.
 */
export function renderPaletteEditorHtml(palette: Rgb[], cspSource: string, nonce: string, opts: PaletteEditorOpts): string {
    const perRow = opts.perRow ?? 16;
    const base = opts.cgramBase ?? 0;
    const bgr = palette.map(rgb8ToBgr555);
    const data = JSON.stringify(bgr);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource};">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  h2 { font-size: 13px; margin: 0 0 2px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 11px; margin-bottom: 12px; }
  #grid { display: grid; grid-template-columns: repeat(${perRow}, 22px); gap: 2px; }
  .sw { width: 22px; height: 22px; border: 1px solid var(--vscode-panel-border); cursor: pointer; box-sizing: border-box; }
  .sw.sel { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .sw.t0 { background-image: linear-gradient(45deg,#888 25%,transparent 25%,transparent 75%,#888 75%),linear-gradient(45deg,#888 25%,#bbb 25%,#bbb 75%,#888 75%); background-size: 8px 8px; background-position: 0 0,4px 4px; }
  .rowlabel { grid-column: 1 / -1; font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
  #editor { margin-top: 16px; display: none; }
  #editor.on { display: block; }
  label { display: inline-block; width: 14px; }
  input[type=range] { vertical-align: middle; width: 220px; }
  .val { display: inline-block; width: 2ch; text-align: right; }
  #preview { display: inline-block; width: 40px; height: 40px; border: 1px solid var(--vscode-panel-border); vertical-align: middle; margin-right: 10px; }
  #hex { font-family: var(--vscode-editor-font-family); }
  button { margin-top: 14px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 5px 12px; cursor: pointer; }
</style>
</head>
<body>
  <h2>Palette — ${opts.fileName}</h2>
  <div class="sub">SNES BGR555 (each channel 0–31). Rows of ${perRow} = sub-palettes; entry 0 is transparent. CGRAM base ${base}. Editing the PNG's palette — <b>Build</b> regenerates the <code>.pal</code>.</div>
  <div id="grid"></div>
  <div id="editor">
    <span id="preview"></span>
    <span>index <b id="idx"></b> · <span id="hex"></span></span><br>
    <label>R</label><input type="range" id="r" min="0" max="31"><span class="val" id="rv"></span>
    <label>G</label><input type="range" id="g" min="0" max="31"><span class="val" id="gv"></span>
    <label>B</label><input type="range" id="b" min="0" max="31"><span class="val" id="bv"></span>
  </div>
  <div><button id="save">Save to PNG</button> <span id="status" class="sub"></span></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const pal = ${data};            // BGR555 words
  const perRow = ${perRow};
  const chans = v => ({ r: v & 31, g: (v>>5)&31, b: (v>>10)&31 });
  const pack = c => ((c.b&31)<<10)|((c.g&31)<<5)|(c.r&31);
  const e5to8 = x => ((x<<3)|(x>>2))&255;
  const cssOf = v => { const c=chans(v); return 'rgb('+e5to8(c.r)+','+e5to8(c.g)+','+e5to8(c.b)+')'; };
  let sel = -1;
  const grid = document.getElementById('grid');
  function build() {
    grid.innerHTML = '';
    for (let i=0;i<pal.length;i++){
      if (i>0 && i%perRow===0){ const l=document.createElement('div'); l.className='rowlabel'; l.textContent='sub-palette '+(i/perRow); grid.appendChild(l); }
      const d=document.createElement('div');
      d.className='sw'+(i%perRow===0?' t0':'')+(i===sel?' sel':'');
      d.style.background = i%perRow===0 ? d.style.background : cssOf(pal[i]);
      if (i%perRow!==0) d.style.backgroundColor = cssOf(pal[i]);
      d.title='index '+i;
      d.onclick=()=>select(i);
      grid.appendChild(d);
    }
  }
  function select(i){ sel=i; const c=chans(pal[i]);
    document.getElementById('editor').classList.add('on');
    document.getElementById('idx').textContent=i;
    r.value=c.r; g.value=c.g; b.value=c.b; sync();
    build();
  }
  const r=document.getElementById('r'), g=document.getElementById('g'), b=document.getElementById('b');
  function sync(){ const c={r:+r.value,g:+g.value,b:+b.value};
    document.getElementById('rv').textContent=c.r;
    document.getElementById('gv').textContent=c.g;
    document.getElementById('bv').textContent=c.b;
    const v=pack(c); pal[sel]=v;
    document.getElementById('preview').style.background=cssOf(v);
    document.getElementById('hex').textContent='$'+v.toString(16).toUpperCase().padStart(4,'0');
    const sw=grid.children; // update the live swatch
    build();
  }
  [r,g,b].forEach(el=>el.oninput=sync);
  document.getElementById('save').onclick=()=>{ vscode.postMessage({type:'save', palette: pal}); document.getElementById('status').textContent='saving…'; };
  window.addEventListener('message', ev=>{ if(ev.data.type==='saved') document.getElementById('status').textContent='saved ✓'; });
  build();
</script>
</body>
</html>`;
}
