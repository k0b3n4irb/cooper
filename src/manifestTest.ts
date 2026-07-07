// Pure helpers for the SDK's project test harness (OpenSNES ≥ 0.29, opensnes#98)
// — no `vscode` import, Node-testable. Cooper is a thin client of `make test`:
// it writes `test/manifest.toml` entries and parses the runner's output. It
// does NOT maintain its own test format (the committed, CI-runnable manifest is
// the contract).
//
// Manifest (TOML):
//   default_steps = 3000000
//   [tests.boot]
//   steps = 3000000
//   [tests.walk_right]
//   steps = 3000000
//   input  = "30:0x100,90:0"        # frame:hex checkpoints (luna --input)
//   assert = ["player_x = 8600"]    # symbol = little-endian hex bytes in WRAM

export const MANIFEST_REL = 'test/manifest.toml';

export interface ManifestTest {
    name: string;
    steps?: number;
    /** luna `frame:mask` script; omit for a visual (fbhash) boot test. */
    input?: string;
    /** `symbol = HEX` assertions (the oracle for input tests). */
    asserts?: string[];
}

/** Names of the `[tests.<name>]` blocks declared in a manifest. */
export function manifestTestNames(toml: string): string[] {
    const out: string[] = [];
    const re = /^\s*\[tests\.([A-Za-z0-9_-]+)\]\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(toml)) !== null) {
        out.push(m[1]);
    }
    return out;
}

function renderBlock(t: ManifestTest): string {
    const lines = [`[tests.${t.name}]`, `steps = ${t.steps ?? 3000000}`];
    if (t.input) {
        lines.push(`input = "${t.input}"`);
    }
    if (t.asserts && t.asserts.length) {
        lines.push(`assert = [${t.asserts.map((a) => `"${a}"`).join(', ')}]`);
    }
    return lines.join('\n') + '\n';
}

/**
 * Insert or replace the `[tests.<name>]` block in `toml`, preserving everything
 * else (default_steps, other tests, comments). Creates a minimal manifest when
 * `toml` is empty. Text-level (no TOML lib) but scoped to the harness subset.
 */
export function upsertManifestTest(toml: string, t: ManifestTest): string {
    const block = renderBlock(t);
    const header = new RegExp(`^\\s*\\[tests\\.${t.name}\\]\\s*$`, 'm');
    const hdr = header.exec(toml);
    if (!hdr) {
        const base = toml.trim() ? toml.replace(/\s*$/, '\n') : 'default_steps = 3000000\n';
        return `${base}\n${block}`;
    }
    // Replace from this header to the next `[` section (or EOF).
    const start = hdr.index;
    const rest = toml.slice(start + hdr[0].length);
    const nextSection = rest.search(/^\s*\[/m);
    const end = nextSection < 0 ? toml.length : start + hdr[0].length + nextSection;
    return toml.slice(0, start) + block + (end < toml.length ? '\n' + toml.slice(end).replace(/^\s*\n/, '') : '');
}

/** `symbol = <little-endian hex>` for `bytes` (e.g. s16 134 → "player_x = 8600"). */
export function formatAssert(symbol: string, bytes: number[]): string {
    const hex = bytes.map((b) => (b & 0xFF).toString(16).toUpperCase().padStart(2, '0')).join('');
    return `${symbol} = ${hex}`;
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

/** Render the `make test` results (static — pair with `enableScripts: false`). */
export function renderHarnessResultsHtml(results: HarnessResult[], cspSource: string): string {
    const rows = results.map((r) =>
        `<div class="${r.pass ? 'ok' : 'bad'}"><span class="mark">${r.pass ? '✓' : '✗'}</span> <b>${escapeHtml(r.name)}</b>` +
        `${r.detail ? ` <span class="sub">${escapeHtml(r.detail)}</span>` : ''}</div>`).join('');
    const passed = results.filter((r) => r.pass).length;
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 10px; font-size: 12px; }
  h3 { margin: 0 0 10px; font-size: 13px; }
  .ok .mark { color: var(--vscode-testing-iconPassed, #89d185); }
  .bad .mark { color: var(--vscode-errorForeground, #f66); font-weight: 700; }
  .ok, .bad { margin: 4px 0; }
  .sub { color: var(--vscode-descriptionForeground); }
</style></head><body>
<h3>Gameplay tests (make test) — ${passed}/${results.length} passed</h3>
${rows || '<p class="sub">no tests — record one with "Cooper: Record Gameplay Test…"</p>'}
<p class="sub" style="margin-top:12px">Committed in <code>test/manifest.toml</code> · runs in CI with <code>make test</code>.</p>
</body></html>`;
}

export interface HarnessResult { name: string; pass: boolean; detail: string; }

/**
 * Parse the project_test.py runner output. Lines: `  PASS  name`,
 * `  FAIL  name: problems`, plus a trailing `TESTS: N/M ok[, K failed]`.
 */
export function parseMakeTestOutput(text: string): HarnessResult[] {
    const out: HarnessResult[] = [];
    for (const line of text.split('\n')) {
        const m = /^\s+(PASS|FAIL)\s+([A-Za-z0-9_-]+)(?::\s*(.*))?$/.exec(line);
        if (m) {
            out.push({ name: m[2], pass: m[1] === 'PASS', detail: (m[3] ?? '').trim() });
        }
    }
    return out;
}
