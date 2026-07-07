// Pure gameplay-regression-test core — no `vscode` import, Node-testable.
//
// A gameplay test = an input script (luna `frame:mask` checkpoints) + a
// framebuffer baseline. Replayed from power-on in a cycle-accurate emulator
// the run is deterministic, so the captured PNG must be byte-identical —
// comparison is plain equality, no fuzzy diffing. Stored Cooper-side under
// `.cooper-tests/` until the SDK owns a `make test` format (opensnes#98).

import { InputCheckpoint, parseInputScript, formatInputScript } from './inputScript';

export const TESTS_DIR = '.cooper-tests';

export interface GameplayTest {
    name: string;
    /** Canonical `frame:0xMASK,…` script (luna --input compatible). */
    script: string;
    /** Frames to run after the last checkpoint before capturing. */
    settleFrames: number;
}

export function serializeTest(t: GameplayTest): string {
    return JSON.stringify({ name: t.name, script: t.script, settleFrames: t.settleFrames }, null, 2) + '\n';
}

export function parseTest(json: string): GameplayTest {
    const o = JSON.parse(json) as Partial<GameplayTest>;
    if (typeof o.name !== 'string' || typeof o.script !== 'string') {
        throw new Error('a gameplay test needs "name" and "script"');
    }
    parseInputScript(o.script); // validate
    return { name: o.name, script: o.script, settleFrames: o.settleFrames ?? 2 };
}

/** The luna-MCP surface the runner needs (LunaMcp satisfies it). */
export interface McpLike {
    reset(): Promise<unknown>;
    frameCount(): Promise<number>;
    stepUntilFrame(maxSteps: number): Promise<{ executed: number }>;
    setJoypad(port: number, mask: number): Promise<unknown>;
    callTool(name: string, args: unknown): Promise<unknown>;
}

/**
 * Replay checkpoints from power-on (luna `--input` semantics) and capture the
 * frame after `settleFrames` more frames. Returns the PNG bytes.
 */
export async function replayAndCapture(mcp: McpLike, checkpoints: InputCheckpoint[], settleFrames: number): Promise<Buffer> {
    await mcp.reset();
    for (const c of checkpoints) {
        while (await mcp.frameCount() < c.frame) {
            await mcp.stepUntilFrame(2_000_000);
        }
        await mcp.setJoypad(0, c.mask);
    }
    for (let i = 0; i < Math.max(1, settleFrames); i++) {
        await mcp.stepUntilFrame(2_000_000);
    }
    const shot = await mcp.callTool('screenshot', { force_display: false }) as { png_base64?: string };
    return Buffer.from(shot?.png_base64 ?? '', 'base64');
}

/** Run one test against its baseline PNG. Deterministic replay ⇒ byte equality. */
export async function runGameplayTest(mcp: McpLike, test: GameplayTest, baseline: Buffer): Promise<{ pass: boolean; actual: Buffer }> {
    const actual = await replayAndCapture(mcp, parseInputScript(test.script), test.settleFrames);
    return { pass: actual.length > 0 && actual.equals(baseline), actual };
}

/** Canonicalize a user-entered script for storage. */
export function canonicalScript(script: string): string {
    return formatInputScript(parseInputScript(script));
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

export interface TestResult { name: string; pass: boolean; detail: string; actualPngB64?: string; baselinePngB64?: string; }

/** Render the results (static — pair with `enableScripts: false`). */
export function renderTestResultsHtml(results: TestResult[], cspSource: string): string {
    const rows = results.map((r) => {
        const imgs = !r.pass && r.actualPngB64 && r.baselinePngB64
            ? `<div class="diff"><figure><img src="data:image/png;base64,${r.baselinePngB64}"/><figcaption>expected</figcaption></figure>
               <figure><img src="data:image/png;base64,${r.actualPngB64}"/><figcaption>actual</figcaption></figure></div>`
            : '';
        return `<div class="${r.pass ? 'ok' : 'bad'}"><span class="mark">${r.pass ? '✓' : '✗'}</span>
          <b>${escapeHtml(r.name)}</b> <span class="sub">${escapeHtml(r.detail)}</span>${imgs}</div>`;
    }).join('');
    const passed = results.filter((r) => r.pass).length;
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 10px; font-size: 12px; }
  h3 { margin: 0 0 10px; font-size: 13px; }
  .ok .mark { color: var(--vscode-testing-iconPassed, #89d185); }
  .bad .mark { color: var(--vscode-errorForeground, #f66); font-weight: 700; }
  .sub { color: var(--vscode-descriptionForeground); }
  .ok, .bad { margin: 4px 0; }
  .diff { display: flex; gap: 12px; margin: 6px 0 10px 18px; }
  figure { margin: 0; } figcaption { color: var(--vscode-descriptionForeground); font-size: 11px; text-align: center; }
  img { image-rendering: pixelated; width: 256px; border: 1px solid #8884; }
</style></head><body>
<h3>Gameplay tests — ${passed}/${results.length} passed</h3>
${rows || '<p class="sub">no tests yet — record one with "Cooper: Record Gameplay Test…"</p>'}
</body></html>`;
}
