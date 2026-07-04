// Pure HTML render for the SNES palette editor webview — no `vscode` import, so
// the markup is unit-testable. Colours are edited in the SNES-native 5-bit BGR555
// space (channels 0..31); when the PNG's pixels are supplied, a live canvas shows
// the actual image recolouring as you edit (WYSIWYG). The client posts the edited
// palette back for writePalette().

import { Rgb, rgb8ToBgr555 } from './pngPalette';

export interface PaletteEditorOpts {
    /** basename shown in the header. */
    fileName: string;
    /** initial colours per sub-palette row (16 = 4bpp, 4 = 2bpp, 256 = 8bpp). */
    perRow?: number;
    /** decoded pixels for the live preview (index per pixel). Omit to skip it. */
    pixels?: { width: number; height: number; indices: number[] };
}

/**
 * Render the palette editor. `palette` is the PNG's 8-bit RGB entries; each is
 * shown/edited as BGR555. Rows of `perRow` mark the SNES sub-palettes; entry 0 of
 * each row is transparent. A bpp selector switches the row width; a live canvas
 * (when `pixels` given) recolours as you edit.
 */
export function renderPaletteEditorHtml(palette: Rgb[], cspSource: string, nonce: string, opts: PaletteEditorOpts): string {
    const perRow = opts.perRow ?? 16;
    const bgr = JSON.stringify(palette.map(rgb8ToBgr555));
    const px = opts.pixels ? JSON.stringify(opts.pixels) : 'null';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource};">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  h2 { font-size: 13px; margin: 0 0 2px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .row { display: flex; gap: 24px; align-items: flex-start; margin-top: 12px; }
  #grid { display: grid; gap: 2px; }
  .sw { width: 22px; height: 22px; border: 1px solid var(--vscode-panel-border); cursor: pointer; box-sizing: border-box; }
  .sw.sel { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .sw.t0 { background-image: linear-gradient(45deg,#888 25%,transparent 25%,transparent 75%,#888 75%),linear-gradient(45deg,#888 25%,#bbb 25%,#bbb 75%,#888 75%); background-size: 8px 8px; background-position: 0 0,4px 4px; }
  .rowlabel { grid-column: 1 / -1; font-size: 10px; color: var(--vscode-descriptionForeground); margin-top: 6px; }
  #spr { image-rendering: pixelated; border: 1px solid var(--vscode-panel-border); background-image: linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),linear-gradient(45deg,#666 25%,#999 25%,#999 75%,#666 75%); background-size: 12px 12px; background-position: 0 0,6px 6px; }
  #editor { margin-top: 16px; display: none; }
  #editor.on { display: block; }
  label { display: inline-block; width: 14px; }
  input[type=range] { vertical-align: middle; width: 220px; }
  .val { display: inline-block; width: 2ch; text-align: right; }
  #preview { display: inline-block; width: 40px; height: 40px; border: 1px solid var(--vscode-panel-border); vertical-align: middle; margin-right: 10px; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
  button { margin-top: 14px; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 5px 12px; cursor: pointer; }
</style>
</head>
<body>
  <h2>Palette — ${opts.fileName}</h2>
  <div class="sub">SNES BGR555 (each channel 0–31). Entry 0 is transparent. CGRAM 0–127 = BG, 128–255 = sprites. Editing the PNG's palette — <b>Build</b> regenerates the <code>.pal</code>.</div>
  <div class="sub" style="margin-top:6px">Sub-palette size:
    <select id="bpp"><option value="4">4 (2bpp)</option><option value="16" selected>16 (4bpp)</option><option value="256">256 (8bpp)</option></select>
  </div>
  <div class="row">
    <div id="grid"></div>
    <div><canvas id="spr"></canvas><div class="sub" id="dim"></div></div>
  </div>
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
  const pal = ${bgr};              // BGR555 words
  const pixels = ${px};            // {width,height,indices} or null
  let perRow = ${perRow};
  const chans = v => ({ r: v & 31, g: (v>>5)&31, b: (v>>10)&31 });
  const pack = c => ((c.b&31)<<10)|((c.g&31)<<5)|(c.r&31);
  const e5to8 = x => ((x<<3)|(x>>2))&255;
  const cssOf = v => { const c=chans(v); return 'rgb('+e5to8(c.r)+','+e5to8(c.g)+','+e5to8(c.b)+')'; };
  let sel = -1;
  const grid = document.getElementById('grid');
  const cv = document.getElementById('spr');
  const ctx = cv.getContext('2d');

  function build() {
    grid.style.gridTemplateColumns = 'repeat('+Math.min(perRow,16)+', 22px)';
    grid.innerHTML = '';
    for (let i=0;i<pal.length;i++){
      if (perRow<=16 && i>0 && i%perRow===0){ const l=document.createElement('div'); l.className='rowlabel'; l.textContent='sub-palette '+(i/perRow); grid.appendChild(l); }
      const d=document.createElement('div');
      const transparent = (i % perRow)===0;
      d.className='sw'+(transparent?' t0':'')+(i===sel?' sel':'');
      if (!transparent) d.style.backgroundColor = cssOf(pal[i]);
      d.title='index '+i;
      d.onclick=()=>select(i);
      grid.appendChild(d);
    }
  }
  function drawSprite(){
    if(!pixels){ cv.style.display='none'; return; }
    const {width:w,height:h,indices}=pixels;
    cv.width=w; cv.height=h;
    const scale=Math.max(1,Math.floor(192/Math.max(w,h)));
    cv.style.width=(w*scale)+'px'; cv.style.height=(h*scale)+'px';
    document.getElementById('dim').textContent=w+'×'+h;
    const img=ctx.createImageData(w,h);
    for(let i=0;i<indices.length;i++){ const idx=indices[i]; const c=chans(pal[idx]||0);
      img.data[i*4]=e5to8(c.r); img.data[i*4+1]=e5to8(c.g); img.data[i*4+2]=e5to8(c.b); img.data[i*4+3]= idx===0 ? 0 : 255; }
    ctx.putImageData(img,0,0);
  }
  function select(i){ sel=i; const c=chans(pal[i]);
    document.getElementById('editor').classList.add('on');
    document.getElementById('idx').textContent=i;
    r.value=c.r; g.value=c.g; b.value=c.b; sync();
  }
  const r=document.getElementById('r'), g=document.getElementById('g'), b=document.getElementById('b');
  function sync(){ const c={r:+r.value,g:+g.value,b:+b.value};
    document.getElementById('rv').textContent=c.r;
    document.getElementById('gv').textContent=c.g;
    document.getElementById('bv').textContent=c.b;
    pal[sel]=pack(c);
    document.getElementById('preview').style.background=cssOf(pal[sel]);
    document.getElementById('hex').textContent='$'+pal[sel].toString(16).toUpperCase().padStart(4,'0');
    build(); drawSprite();
  }
  [r,g,b].forEach(el=>el.oninput=sync);
  document.getElementById('bpp').onchange=e=>{ perRow=+e.target.value; build(); };
  document.getElementById('save').onclick=()=>{ vscode.postMessage({type:'save', palette: pal}); document.getElementById('status').textContent='saving…'; };
  window.addEventListener('message', ev=>{ if(ev.data.type==='saved') document.getElementById('status').textContent='saved ✓'; });
  build(); drawSprite();
</script>
</body>
</html>`;
}
