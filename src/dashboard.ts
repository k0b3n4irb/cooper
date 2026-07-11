// Pure HTML for Cooper's "Mission Control" dashboard webview — no `vscode`
// import, so the markup is Node-testable. The glue (panel, messaging, preview)
// lives in extension.ts. Styled with VS Code theme variables so it matches the
// user's theme, with light SNES-studio flair (pad-colour accents, console-bezel
// preview) — the immersion is ambient, never a different UI toolkit (UX-2).

import { nextStep, StudioState } from './missionControl';

export interface DashboardState extends Omit<StudioState, 'projectName'> {
    hasProject: boolean;
    projectName: string;
    sdkName: string | null;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

/**
 * Render the dashboard. `cspSource` is the webview's `cspSource`; `nonce` gates
 * the inline <script>. Buttons/cards carry `data-cmd` — the script posts that as
 * a message the extension dispatches to the matching command.
 */
export function renderDashboardHtml(s: DashboardState, cspSource: string, nonce: string): string {
    const head = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 20px 24px; }
  h1 { font-size: 26px; letter-spacing: 2px; margin: 0; color: var(--vscode-textLink-foreground); }
  .sub { color: var(--vscode-descriptionForeground); margin: 2px 0 18px; }
  .row { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; gap: 6px; border: none; border-radius: 4px;
         padding: 9px 18px; font-size: 13px; font-weight: 600; cursor: pointer;
         color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  .btn:hover { background: var(--vscode-button-hoverBackground); }
  .btn.alt { color: var(--vscode-button-secondaryForeground); background: var(--vscode-button-secondaryBackground); }
  .btn.alt:hover { background: var(--vscode-button-secondaryHoverBackground); }
  .grid { display: flex; gap: 16px; flex-wrap: wrap; align-items: flex-start; }
  .panel { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border);
           border-radius: 8px; padding: 14px; }
  .panel-t { font-size: 13px; font-weight: 600; margin-bottom: 10px; }
  .preview { width: 360px; }
  #preview { width: 320px; height: 168px; object-fit: contain; image-rendering: pixelated;
             background: #000; border: 1px solid var(--vscode-widget-border); border-radius: 2px; }
  .ph { width: 318px; height: 166px; display: flex; align-items: center; justify-content: center;
        color: var(--vscode-descriptionForeground); border: 1px dashed var(--vscode-widget-border);
        border-radius: 2px; font-size: 12px; }
  .cards { display: flex; flex-direction: column; gap: 10px; min-width: 280px; flex: 1; }
  .card { background: var(--vscode-editorWidget-background); border: 1px solid var(--vscode-widget-border);
          border-radius: 8px; padding: 12px 14px; cursor: pointer; }
  .card:hover { border-color: var(--vscode-focusBorder); }
  .card-t { font-size: 15px; font-weight: 600; }
  .card-s { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 2px; }
  .status { color: var(--vscode-descriptionForeground); font-size: 12px; margin-top: 22px; }
  .ok { color: var(--vscode-testing-iconPassed, #89d185); }
  .warn { color: var(--vscode-list-warningForeground, #cca700); }
  .empty { color: var(--vscode-descriptionForeground); padding: 40px 0; text-align: center; }
  /* SNES-studio flair (ambient, theme-aware) */
  .pads span { display:inline-block; width:9px; height:9px; border-radius:50%; margin-left:4px; }
  .pad-x{background:#4040c8} .pad-y{background:#40a040} .pad-a{background:#c84040} .pad-b{background:#c8b820}
  .next { display:flex; align-items:center; gap:14px; margin:0 0 18px; padding:12px 16px;
          border-left: 3px solid var(--vscode-textLink-foreground);
          background: var(--vscode-editorWidget-background); border-radius: 4px; }
  .next-t { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: var(--vscode-descriptionForeground); }
  .next-h { color: var(--vscode-descriptionForeground); font-size: 12px; }
  #preview { border-radius: 6px; box-shadow: inset 0 0 24px rgba(0,0,0,.55); border: 6px solid #1c1c22; }
</style></head><body>`;

    if (!s.hasProject) {
        const emptyScript = `<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('new-game').addEventListener('click', () => vscode.postMessage({ command: 'newgame' }));
    document.getElementById('new-project').addEventListener('click', () => vscode.postMessage({ command: 'new' }));
  </script>`;
        return head + `<h1>COOPER</h1><div class="empty">Start a new SNES game, guided —<br>
pick a game type and Cooper sets up the project for you:<br><br>
<button class="btn" id="new-game">🎮 New Game…</button><br><br>
<span class="sub">or start from an SDK example:</span><br>
<button class="btn alt" id="new-project">✨ New Project…</button></div>` + emptyScript + '</body></html>';
    }

    const dot = (ok: boolean, label: string) => `<span class="${ok ? 'ok' : 'warn'}">${label}</span>`;
    const step = nextStep({ ...s, projectName: s.projectName || null });
    const body = `
  <h1>COOPER <span class="pads"><span class="pad-x"></span><span class="pad-y"></span><span class="pad-a"></span><span class="pad-b"></span></span></h1>
  <div class="sub">${escapeHtml(s.projectName)}</div>
  <div class="next">
    <span class="next-t">NEXT&nbsp;STEP</span>
    <button class="btn" data-cmd="${step.cmd}">${step.label}</button>
    <span class="next-h">${escapeHtml(step.hint)}</span>
  </div>
  <div class="row">
    <button class="btn" data-cmd="build">▶ Build</button>
    <button class="btn" data-cmd="run">▶ Run</button>
    <button class="btn" data-cmd="play">🎮 Play</button>
    <button class="btn alt" data-cmd="debug">🐞 Debug</button>
  </div>
  <div class="grid">
    <div class="panel preview">
      <div class="panel-t">Last preview · 256×224</div>
      <img id="preview" style="display:none" alt="preview"/>
      <div class="ph" id="preview-empty">Click <b>&nbsp;Run&nbsp;</b> to render a frame</div>
      <div style="margin-top:10px"><button class="btn alt" data-cmd="run">↻ Update preview</button></div>
    </div>
    <div class="cards">
      <div class="card" data-cmd="palette"><div class="card-t">🎨 Palette</div><div class="card-s">CGRAM · 256 colours</div></div>
      <div class="card" data-cmd="oam"><div class="card-t">👾 Sprites</div><div class="card-s">OAM · 128 objects</div></div>
      <div class="card" data-cmd="vram"><div class="card-t">🧱 Tiles</div><div class="card-s">VRAM · tile sheet</div></div>
    </div>
  </div>
  <div class="status">SDK ${dot(!!s.sdkName, s.sdkName ?? 'not set')} · luna ${dot(s.lunaFound, s.lunaFound ? 'ready' : 'not found')} · ROM ${dot(s.romBuilt, s.romBuilt ? 'built' : 'not built')}
    <button class="btn alt" data-cmd="refresh" style="margin-left:10px;padding:3px 10px;font-size:11px">↻ Refresh status</button>
    <button class="btn alt" data-cmd="newgame" style="margin-left:6px;padding:3px 10px;font-size:11px">🎮 New Game…</button></div>`;

    const script = `<script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    for (const el of document.querySelectorAll('[data-cmd]')) {
      el.addEventListener('click', () => vscode.postMessage({ command: el.getAttribute('data-cmd') }));
    }
    window.addEventListener('message', (e) => {
      const m = e.data || {};
      if (m.type === 'preview' && m.dataUri) {
        const img = document.getElementById('preview');
        img.src = m.dataUri; img.style.display = 'block';
        document.getElementById('preview-empty').style.display = 'none';
      }
    });
    vscode.postMessage({ command: 'ready' });
  </script>`;

    return head + body + script + '</body></html>';
}
