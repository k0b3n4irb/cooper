// Pure HTML for the SFX synthesizer webview — no `vscode` import, Node-testable.
// The glue (panel, synth on message, Add-to-game wiring) lives in extension.ts.
// Preview plays in the webview via WebAudio from PCM the EXTENSION synthesized
// (single source of truth: sfxSynth.ts — no duplicated synth in JS).

import { SFX_PRESETS } from './sfxSynth';

export function renderSfxSynthHtml(cspSource: string, nonce: string): string {
    const presets = Object.keys(SFX_PRESETS);
    const slider = (id: string, label: string, min: number, max: number, step: number, value: number): string =>
        `<label class="p"><span>${label}</span><input type="range" id="${id}" min="${min}" max="${max}" step="${step}" value="${value}"><em id="${id}-v">${value}</em></label>`;
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 18px 22px; max-width: 760px; }
  h1 { font-size: 20px; letter-spacing: 1px; margin: 0 0 2px; color: var(--vscode-textLink-foreground); }
  .sub { color: var(--vscode-descriptionForeground); margin-bottom: 14px; font-size: 12px; }
  .pads span { display:inline-block; width:8px; height:8px; border-radius:50%; margin-left:3px; }
  .pad-x{background:#4040c8}.pad-y{background:#40a040}.pad-a{background:#c84040}.pad-b{background:#c8b820}
  .row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px; }
  .btn { border:none; border-radius:4px; padding:7px 14px; font-size:12px; font-weight:600; cursor:pointer;
         color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn.alt { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .panel { background: var(--vscode-editorWidget-background); border:1px solid var(--vscode-widget-border);
           border-radius:8px; padding:14px 16px; margin-bottom:14px; }
  .p { display:grid; grid-template-columns: 120px 1fr 60px; align-items:center; gap:10px; margin:6px 0; font-size:12px; }
  .p em { font-style:normal; color: var(--vscode-descriptionForeground); text-align:right; }
  select, input[type=text] { background: var(--vscode-input-background); color: var(--vscode-input-foreground);
           border:1px solid var(--vscode-input-border, transparent); border-radius:3px; padding:4px 8px; }
  canvas { width:100%; height:90px; background:#101014; border-radius:6px; border:4px solid #1c1c22; }
  .add { display:flex; gap:10px; align-items:center; }
</style></head><body>
<h1>SFX SYNTH <span class="pads"><span class="pad-x"></span><span class="pad-y"></span><span class="pad-a"></span><span class="pad-b"></span></span></h1>
<div class="sub">Pick a preset, shape it, preview, then add it to your game (WAV → soundbank, wired for you).</div>

<div class="row" id="presets">${presets.map((k) => `<button class="btn alt" data-preset="${k}">${k}</button>`).join('')}</div>

<div class="panel">
  <label class="p"><span>waveform</span>
    <select id="wave"><option>square</option><option>triangle</option><option>saw</option><option>sine</option><option>noise</option></select><em></em></label>
  ${slider('baseFreq', 'frequency (Hz)', 20, 4000, 1, 700)}
  ${slider('freqSlide', 'slide (oct/s)', -8, 8, 0.1, 0)}
  ${slider('duty', 'duty (square)', 0.1, 0.9, 0.05, 0.5)}
  ${slider('attack', 'attack (s)', 0, 0.5, 0.005, 0.001)}
  ${slider('decay', 'decay (s)', 0.01, 1, 0.01, 0.1)}
  ${slider('duration', 'duration (s)', 0.03, 1.5, 0.01, 0.25)}
  ${slider('vibratoDepth', 'vibrato (semi)', 0, 4, 0.1, 0)}
  ${slider('vibratoSpeed', 'vibrato (Hz)', 0, 20, 0.5, 8)}
  ${slider('volume', 'volume', 0, 1, 0.05, 0.7)}
</div>

<canvas id="wavecanvas" width="720" height="90"></canvas>
<div class="row" style="margin-top:12px">
  <button class="btn" id="preview">▶ Preview</button>
  <span class="add"><input type="text" id="name" value="coin" size="14" spellcheck="false">
  <button class="btn" id="add">➕ Add to game</button></span>
</div>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const PRESETS = ${JSON.stringify(SFX_PRESETS)};
  const ids = ['baseFreq','freqSlide','duty','attack','decay','duration','vibratoDepth','vibratoSpeed','volume'];
  let arp = null; // presets may carry an arpeggio; sliders don't edit it (kept as-is)
  function params(){
    const p = { wave: document.getElementById('wave').value };
    for (const id of ids) p[id] = Number(document.getElementById(id).value);
    if (arp) p.arp = arp;
    return p;
  }
  function setParams(p){
    document.getElementById('wave').value = p.wave;
    for (const id of ids){ const el=document.getElementById(id); el.value=p[id] ?? el.value; document.getElementById(id+'-v').textContent=el.value; }
    arp = p.arp || null;
  }
  for (const id of ids){ document.getElementById(id).addEventListener('input', ()=>{ document.getElementById(id+'-v').textContent=document.getElementById(id).value; }); }
  for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', ()=>{ setParams(PRESETS[b.getAttribute('data-preset')]); document.getElementById('name').value=b.getAttribute('data-preset'); vscode.postMessage({type:'synth', params: params()}); });
  document.getElementById('preview').addEventListener('click', ()=> vscode.postMessage({type:'synth', params: params()}));
  document.getElementById('add').addEventListener('click', ()=> vscode.postMessage({type:'add', params: params(), name: document.getElementById('name').value}));
  let audioCtx;
  window.addEventListener('message', (e)=>{
    const m = e.data || {};
    if (m.type !== 'pcm') return;
    const raw = atob(m.b64); const n = raw.length/2; const f = new Float32Array(n);
    for (let i=0;i<n;i++){ let v = raw.charCodeAt(2*i) | (raw.charCodeAt(2*i+1)<<8); if (v>=0x8000) v-=0x10000; f[i]=v/32768; }
    // draw
    const c=document.getElementById('wavecanvas'), g=c.getContext('2d');
    g.clearRect(0,0,c.width,c.height); g.strokeStyle='#4fd07a'; g.beginPath();
    for(let x=0;x<c.width;x++){ const v=f[Math.floor(x*n/c.width)]||0; const y=c.height/2-(v*c.height*0.45); x?g.lineTo(x,y):g.moveTo(x,y); }
    g.stroke();
    // play
    audioCtx = audioCtx || new AudioContext();
    const buf = audioCtx.createBuffer(1, n, m.rate);
    buf.getChannelData(0).set(f);
    const src = audioCtx.createBufferSource(); src.buffer = buf; src.connect(audioCtx.destination); src.start();
  });
  setParams(PRESETS.coin); vscode.postMessage({type:'synth', params: params()});
</script></body></html>`;
}
