# Cooper — current snapshot

_Last updated 2026-06-27._ The full plan (all phases, dependencies, open
decisions) lives in **`roadmap.md`** — this file is just the "now".

## Last shipped

**The Cooper sidebar** (v0.11.0). Activity-bar tree → everything clickable:
PROJECT (ROM/SDK), BUILD & RUN, PPU VIEWERS, SYMBOLS (your functions from `.c` ∩
`.sym`; click → set a breakpoint). Debug-from-tree handles subfolder projects.
Pure model in `src/sidebar.ts`; both tiers verified. **GUI layer step 1** (chosen
from 3 mockups: sidebar/dashboard/codelens — sidebar first). D-028. Next: webview
dashboard (#2), CodeLens (#3).

**Frictionless C onboarding** (v0.10.0). Open a C file in an OpenSNES project →
Cooper auto-writes `.clangd` (no command). Resolves the project from the active
file's nearest Makefile (subfolders), one picker for out-of-tree SDK, never
clobbers, opt-out `cooper.autoConfigureClangd`. Both tiers verified (auto-write in
the real host). D-027. Earlier: ⛔ compile_commands.json reverted (0.9.1, D-026).

**P2.2c — debugger PPU viewers** (palette 0.6.0 · OAM 0.7.0 · VRAM tiles 0.8.0).
Three webviews of the live PPU at a debug stop: **CGRAM palette** (16×16 swatches),
**OAM** (128-sprite table), **VRAM tiles** (512 4bpp tiles → PNG). Decoded in pure
`src/ppu.ts`/`src/tiles.ts` (incl. a zero-dep PNG encoder); fed by custom DAP
requests `cooperPpu`/`cooperVram`. Verified both tiers + visually (VRAM PNG shows
real font glyphs). 101 Node + 3 integration tests. D-023…D-025.

Before it: **P2.2b** data breakpoints (0.5.0); **P2.2a** memory view (0.4.0);
**P2.1** ASM/symbol debugger MVP (0.3.0); test harness (D-022); P0 (0.2.0); #3/#2/#1.

## Current focus

**🎨 The GUI layer (user priority — "a graphical IDE like GitLens, not 1000
keyboard shortcuts; beautiful and easy").** Backend (debugger + viewers) is
feature-complete; the work now is **making it feel like an IDE**, not more
capability. Plan chosen from 3 SVG mockups (`/tmp/cooper_ui_{1,2,3}.png`):
- ✅ **Sidebar (0.11.0)** — the clickable backbone. Done.
- 🔜 **Webview dashboard / Home** (mockup #2) — big Build/Run/Debug buttons, live
  preview thumbnail, palette/sprite/tile cards. The "beau" wow. Webview-heavy but
  integration-testable.
- 🔜 **CodeLens + inline actions** (mockup #3) — "▶ Debug here · 👁 watch" above
  functions; editor-title Build/Run/Debug buttons. Finishing polish.
- Also: one-click clangd download surfaced proactively; build-before-debug.

North star: **open project → it just works, and looks good.** See
[[cooper-simplicity-over-features]]. Deferred: viewer selectors; multi-bp
continue; source-level (P7, G0 flags).

## Foundations in place

TS + esbuild build (`npm run compile`/`watch`/`package`), `vsce` packaging, WLA
grammar generator. Single extension at root; promote to npm-workspaces when a 2nd
package lands. **Two test tiers** (D-022): `npm test` = fast Node tier (pure
modules + the DAP session driven directly, no display); `npm run test:integration`
= real Extension Development Host via `@vscode/test-electron` (verifies the
`vscode` glue + debug adapter; downloads VS Code into `.vscode-test/`; `xvfb-run
-a` on headless CI).

## Watch items

- luna MCP catalogue gaps surfaced by P2.1 (D-016): no `peek_cgram`/`peek_oam`
  tool (blocks bulk CGRAM/OAM views); no multi-breakpoint "continue" or async
  stop-event; mem-watch is **bank-exact** (watch `$80:..` FastROM, `$00:..` LoROM).
- Source-level debug (P7) gated on G0 build flags (`wla -i` + `wlalink -S -A`).
- Open decisions: `roadmap.md` (Q4 tiles wrap-vs-build, Q5 debugger-vs-assets).
