// Pure HTML render for the SNES tile/sprite editor webview — no `vscode` import.
// Paints the indexed PNG's pixels (one palette index each) on a zoomable canvas
// with an 8×8 tile grid and a selectable sprite-cell overlay (the 6 OBSEL size
// pairs are square multiples of 8). Save posts the indices back for
// writeIndexedPixels(); the source PNG stays what gfx4snes consumes.

import { Rgb, rgb8ToBgr555 } from './pngPalette';

export interface TileEditorOpts {
    fileName: string;
    /** palette entries shown in the picker strip (16 = 4bpp sub-palette). */
    paletteCount?: number;
    /** sprite-cell size for the overlay (8/16/32/64). */
    cellSize?: number;
}

/** SNES OBJ (sprite) cell sizes, in px — square multiples of the 8×8 tile. */
export const SPRITE_CELLS = [8, 16, 32, 64];

export function renderTileEditorHtml(
    pixels: { width: number; height: number; indices: number[] },
    palette: Rgb[],
    cspSource: string,
    nonce: string,
    opts: TileEditorOpts,
): string {
    const paletteCount = opts.paletteCount ?? 16;
    const cell = opts.cellSize ?? 8;
    const bgr = JSON.stringify(palette.map(rgb8ToBgr555));
    const px = JSON.stringify(pixels);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${cspSource};">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 12px; }
  h2 { font-size: 13px; margin: 0 0 2px; }
  .sub { color: var(--vscode-descriptionForeground); font-size: 11px; }
  .bar { margin: 10px 0; display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
  #strip { display: flex; gap: 2px; }
  .sw { width: 22px; height: 22px; border: 1px solid var(--vscode-panel-border); cursor: pointer; box-sizing: border-box; }
  .sw.sel { outline: 2px solid var(--vscode-focusBorder); outline-offset: 1px; }
  .sw.t0 { background-image: linear-gradient(45deg,#888 25%,transparent 25%,transparent 75%,#888 75%),linear-gradient(45deg,#888 25%,#bbb 25%,#bbb 75%,#888 75%); background-size: 8px 8px; background-position: 0 0,4px 4px; }
  #wrap { overflow: auto; max-height: 60vh; border: 1px solid var(--vscode-panel-border); display: inline-block; background-image: linear-gradient(45deg,#666 25%,transparent 25%,transparent 75%,#666 75%),linear-gradient(45deg,#666 25%,#999 25%,#999 75%,#666 75%); background-size: 16px 16px; background-position: 0 0,8px 8px; }
  canvas { display: block; image-rendering: pixelated; cursor: crosshair; }
  select, button { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
  #save { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 5px 12px; cursor: pointer; }
  label { font-size: 11px; }
</style>
</head>
<body>
  <h2>Tiles — ${opts.fileName}</h2>
  <div class="sub">Paint indexed pixels. Grey lines = 8×8 tiles; blue lines = sprite cells. Editing the PNG — <b>Build</b> regenerates the <code>.pic</code>. Index 0 is transparent.</div>
  <div class="bar">
    <span>Colour: <span id="strip"></span></span>
  </div>
  <div class="bar">
    <label>Cell <select id="cell"><option>8</option><option>16</option><option>32</option><option>64</option></select></label>
    <label><input type="checkbox" id="gridck" checked> grid</label>
    <label>Zoom <button id="zout">−</button> <span id="zval"></span> <button id="zin">+</button></label>
    <span id="pos" class="sub"></span>
  </div>
  <div id="wrap"><canvas id="c"></canvas></div>
  <div class="bar">
    <span class="sub">Animation:</span>
    <label>from cell <input type="number" id="afrom" value="0" min="0" style="width:52px"></label>
    <label>frames <input type="number" id="acount" value="2" min="1" max="16" style="width:44px"></label>
    <label>fps <select id="afps"><option>4</option><option selected>8</option><option>12</option><option>15</option><option>30</option></select></label>
    <button id="aplay">▶ play</button>
    <canvas id="apreview" width="64" height="64" style="image-rendering:pixelated;border:1px solid var(--vscode-panel-border);vertical-align:middle"></canvas>
    <span id="aframe" class="sub"></span>
  </div>
  <div class="bar"><button id="undo">Undo</button> <button id="redo">Redo</button> <button id="save">Save to PNG</button> <span id="status" class="sub"></span></div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const pal = ${bgr};
  const pix = ${px};
  const W = pix.width, H = pix.height, idx = pix.indices.slice();
  let active = 1, scale = 10, cell = ${cell}, showGrid = true;
  const chans = v => ({ r: v & 31, g: (v>>5)&31, b: (v>>10)&31 });
  const e5 = x => ((x<<3)|(x>>2))&255;
  const cssOf = v => { const c=chans(v); return 'rgb('+e5(c.r)+','+e5(c.g)+','+e5(c.b)+')'; };
  const c = document.getElementById('c'), ctx = c.getContext('2d');
  const paletteCount = ${paletteCount};

  function strip(){
    const s=document.getElementById('strip'); s.innerHTML='';
    for(let i=0;i<Math.min(paletteCount, pal.length);i++){
      const d=document.createElement('div');
      d.className='sw'+(i===0?' t0':'')+(i===active?' sel':'');
      if(i!==0) d.style.backgroundColor=cssOf(pal[i]);
      d.title='index '+i; d.onclick=()=>{active=i; strip();};
      s.appendChild(d);
    }
  }
  function draw(){
    c.width=W*scale; c.height=H*scale;
    document.getElementById('zval').textContent=scale+'×';
    for(let y=0;y<H;y++)for(let x=0;x<W;x++){
      const v=idx[y*W+x];
      if(v===0){ continue; } // transparent — show the checkerboard behind
      ctx.fillStyle=cssOf(pal[v]||0); ctx.fillRect(x*scale,y*scale,scale,scale);
    }
    if(showGrid){
      ctx.lineWidth=1;
      for(let x=0;x<=W;x++){ ctx.strokeStyle=(x%cell===0)?'rgba(80,140,255,0.9)':'rgba(128,128,128,0.35)'; ctx.beginPath(); ctx.moveTo(x*scale+0.5,0); ctx.lineTo(x*scale+0.5,H*scale); ctx.stroke(); }
      for(let y=0;y<=H;y++){ ctx.strokeStyle=(y%cell===0)?'rgba(80,140,255,0.9)':'rgba(128,128,128,0.35)'; ctx.beginPath(); ctx.moveTo(0,y*scale+0.5); ctx.lineTo(W*scale,y*scale+0.5); ctx.stroke(); }
    }
  }
  function paintAt(ev){
    const r=c.getBoundingClientRect();
    const x=Math.floor((ev.clientX-r.left)/scale), y=Math.floor((ev.clientY-r.top)/scale);
    if(x<0||y<0||x>=W||y>=H) return;
    document.getElementById('pos').textContent='('+x+','+y+')';
    if(painting && idx[y*W+x]!==active){ idx[y*W+x]=active; dirty=true; draw(); }
  }
  // undo/redo history (snapshots of the whole index array, one per stroke)
  let hist=[idx.slice()], hi=0, dirty=false;
  function snapshot(){ hist=hist.slice(0,hi+1); hist.push(idx.slice()); hi=hist.length-1; if(hist.length>200){hist.shift();hi--;} }
  function restore(a){ for(let i=0;i<idx.length;i++) idx[i]=a[i]; draw(); }
  function undo(){ if(hi>0){ hi--; restore(hist[hi]); } }
  function redo(){ if(hi<hist.length-1){ hi++; restore(hist[hi]); } }
  let painting=false;
  c.addEventListener('mousedown',e=>{painting=true; dirty=false; const r=c.getBoundingClientRect(); const x=Math.floor((e.clientX-r.left)/scale),y=Math.floor((e.clientY-r.top)/scale); if(x>=0&&y>=0&&x<W&&y<H&&idx[y*W+x]!==active){idx[y*W+x]=active; dirty=true; draw();}});
  window.addEventListener('mouseup',()=>{ if(painting&&dirty){ snapshot(); } painting=false; });
  c.addEventListener('mousemove',paintAt);
  document.getElementById('undo').onclick=undo;
  document.getElementById('redo').onclick=redo;
  window.addEventListener('keydown',e=>{ if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){ e.preventDefault(); e.shiftKey?redo():undo(); } else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){ e.preventDefault(); redo(); } });
  document.getElementById('cell').onchange=e=>{cell=+e.target.value; draw();};
  document.getElementById('gridck').onchange=e=>{showGrid=e.target.checked; draw();};
  document.getElementById('zin').onclick=()=>{scale=Math.min(24,scale+2); draw();};
  document.getElementById('zout').onclick=()=>{scale=Math.max(2,scale-2); draw();};
  document.getElementById('save').onclick=()=>{ vscode.postMessage({type:'save', indices: idx}); document.getElementById('status').textContent='saving…'; };
  window.addEventListener('message',ev=>{ if(ev.data.type==='saved') document.getElementById('status').textContent='saved ✓'; });
  document.getElementById('cell').value=String(cell);

  // --- animation preview (G8a): consecutive sprite cells as frames, played
  // live on the pixels being edited. Cells are row-major over the sheet.
  const ap = document.getElementById('apreview'), apx = ap.getContext('2d');
  let aTimer = null, aStep = 0;
  function cellOrigin(n){ const perRow = Math.max(1, Math.floor(W/cell)); return { x: (n%perRow)*cell, y: Math.floor(n/perRow)*cell }; }
  function cellCount(){ return Math.max(1, Math.floor(W/cell)) * Math.max(1, Math.floor(H/cell)); }
  function drawAnimFrame(){
    const from = Math.min(+document.getElementById('afrom').value || 0, cellCount()-1);
    const count = Math.max(1, Math.min(16, +document.getElementById('acount').value || 1));
    const n = (from + (aStep % count)) % cellCount();
    const o = cellOrigin(n), z = Math.max(1, Math.floor(64/cell));
    ap.width = cell*z; ap.height = cell*z;
    apx.clearRect(0,0,ap.width,ap.height);
    for(let y=0;y<cell;y++)for(let x=0;x<cell;x++){
      const sx=o.x+x, sy=o.y+y;
      if(sx>=W||sy>=H) continue;
      const v=idx[sy*W+sx];
      if(v===0) continue;
      apx.fillStyle=cssOf(pal[v]||0); apx.fillRect(x*z,y*z,z,z);
    }
    document.getElementById('aframe').textContent='cell '+n;
  }
  function aTick(){ drawAnimFrame(); aStep++; }
  document.getElementById('aplay').onclick=()=>{
    if(aTimer){ clearInterval(aTimer); aTimer=null; document.getElementById('aplay').textContent='▶ play'; return; }
    const fps=+document.getElementById('afps').value||8;
    aStep=0; aTick(); aTimer=setInterval(aTick, Math.round(1000/fps));
    document.getElementById('aplay').textContent='⏸ pause';
  };
  document.getElementById('afps').onchange=()=>{ if(aTimer){ clearInterval(aTimer); aTimer=setInterval(aTick, Math.round(1000/(+document.getElementById('afps').value||8))); } };
  for (const id of ['afrom','acount']) document.getElementById(id).onchange=drawAnimFrame;

  strip(); draw(); drawAnimFrame();
</script>
</body>
</html>`;
}
