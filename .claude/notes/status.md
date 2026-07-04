# Cooper — current snapshot

_Last updated 2026-06-27._ The full plan (all phases, dependencies, open
decisions) lives in **`roadmap.md`** — this file is just the "now".

## Last shipped

**AI helper (C7) part 1 — ship OpenSNES context** (v0.22.0). Cooper: Configure AI
writes AGENTS.md (+ .github/copilot-instructions.md) with the SNES/OpenSNES rules
(int=2, BGR555/CGRAM, sprite/tilemap limits, build/run/luna) so any assistant
becomes OpenSNES-expert. Pure aiContext.ts (renderAgentsMd/renderCopilotInstructions)
+ cooper.configureAI. Grounded current MCP facts for the next slices (register luna
MCP via VS Code extension API `mcpServerDefinitionProviders`; OpenSNES MCP via
@modelcontextprotocol/sdk v1.x). 215 Node + 8 integration. D-043. Also: tile editor
undo/redo (0.21.1). Next C7: (2) register luna MCP, (3) OpenSNES MCP + verify loop.

**Tilemap viewer (C6, hardware-faithful — not a Tiled clone)** (v0.21.0).
Right-click a .map → assembled background with real per-cell 16-bit attributes
(sub-palette + H/V flip) that Tiled doesn't show. Grounding decided: tilemap
*authoring* = Tiled (off-the-shelf, SDK integrates via tmx2snes) so Cooper builds
the VIEWER, not an editor (D-042). Pure tilemap.ts (parseTilemapEntries +
assembleTilemapRgba, reuses tiles.ts) + cooper.viewTilemap. Verified visually (mode1
→ exact OpenSNES-logo bg). 207 Node + 8 integration. C6 asset editors: palette +
tiles (editors) + tilemap (viewer) done. Next big axis: C7 (AI helper).

**SNES tile/sprite editor (C6)** (v0.20.0). Right-click a .png → paint grid over the
indexed image: palette-strip colour pick, 8×8 tile overlay + sprite-cell guide
(8/16/32/64), zoom, Save → writeIndexedPixels re-encodes IDAT (filter None + zlib,
keeps PLTE) → Build regenerates the .pic. Verified end-to-end (paint → gfx4snes
accepts → round-trips). tileEditor.ts + cooper.editTiles. Palette editor got live
preview + bpp selector (0.19.1). 203 Node + 8 integration. D-041. Next C6: tilemap.

**SNES palette editor (C6, first asset editor)** (v0.19.0). Right-click an indexed
PNG → BGR555 editor (channels 0–31, rows of 16 = sub-palettes, entry 0 transparent);
Save writes the PNG's PLTE → Build regenerates the .pal. Edits the *source* PNG
gfx4snes consumes (conversion stays in make). Pure pngPalette.ts (PLTE read/write +
BGR555, byte-identical to gfx4snes — verified 16/16 vs a real .pal) + paletteEditor.ts
webview + cooper.editPalette glue. 193 Node + 8 integration. D-040. Next C6:
tile/sprite editor (6 OBSEL size pairs), then tilemap.

**Release vs debug builds** (v0.18.0). Build/Run = release (plain make, byte-
identical to the shipped ROM); Debug (F5) auto-builds `-g` (wla -i/wlalink -A +
CC65816_G=1) just before launch, so debug info never leaks into a preview and you
needn't Build first. Grounded: debug metadata perturbs codegen (OpenSNES CI: 5
examples' framebuffer diverged in -g), and the shipped ~/bin/opensnes gates debug
emission behind CC65816_G (verified). buildMakeArgs(sdk,target,debug) +
runMakeAndWait + resolveDebugConfiguration. 180 Node + 8 integration. D-039.

**Aggregate expansion** (v0.17.0). Struct/array locals expand in Variables →
fields (named, typed, at offsets) and elements ([0],[1]…), recursively. Path:
cproc writes a `.dbg` sidecar (recursive type grammar per aggregate local) →
Cooper parseAggregates + aggChildren + dynamic variablesReferences read each
child from frameBase+offset. Verified: parseAggregates on real cfg + synthetic
array/nested; aggChildren pure. 179 Node + 8 integration. D-038. (Also fixed a
stray NUL byte in a sym.ts map key.)

**Typed local variables (G4)** (v0.16.0). VARIABLES → Locals shows the current
function's C vars (pad/dx/cfg…) read from the stack frame, typed (u16/s16/pointer/
struct). Path: QBE `-g` (no-promote, keeps locals in memory) + cproc encodes
name+type into the alloc temp + backend emits `; @dbglocal name offset` + Cooper
parseLocals/enclosingFunction → reads frameBase+offset → formatLocal. Builds pass
CC65816_G=1. Verified end-to-end (pad=u16 in on_update). 171 Node + 8 integration.
Compiler changes in the OpenSNES repo. D-037. Limitations: frame base = SP at stop;
aggregates as raw bytes; -g builds unoptimised.

**C-line stepping** (v0.15.0). Step Over/Into/Out advance a C source line, not a
CPU instruction (over skips calls via run_until_pc; out runs to frame return).
Pure `callLen`/`stepStops` tested; real-binary DAP test confirms a Step Over moves
to a different main.c line. 157 Node + 8 integration. D-036.

**Source-level C debug (P7) — the jewel** (v0.14.0). Your `main.c` line highlights
at a stop; gutter breakpoints on C lines. Path: patched cproc/QBE emit `; @cline N`
→ `.sym` addr-to-line (Cooper auto-passes `wla -i`/`wlalink -A`) → `buildCLineMap`
joins to PC↔main.c:line → DAP frame `source`+`line` + source breakpoints. Verified
headless end-to-end (bp on main.c:237 → frame source=main.c). Compiler changes are
in the OpenSNES repo (cproc/QBE), for the author to commit. D-034/D-035. 145 Node +
8 integration. Remaining: typed locals (G4). Earlier: walkthrough (0.13), dashboard
(0.12), sidebar (0.11), …

## Last shipped (earlier)

**The Cooper dashboard "Home"** (v0.12.0). Webview with big Build/Run/Debug
buttons, a live preview thumbnail (luna screenshot pushed as base64), and
Palette/Sprites/Tiles cards + status. Opens from the 🏠 sidebar-header button.
Themed with VS Code vars; strict CSP (nonce). `renderDashboardHtml` pure-tested;
opens in the real Extension Host. D-031. GUI layer step 2 (sidebar #1, dashboard
#2; CodeLens #3 next). Also fixed: build OPENSNES override (0.11.1), luna
file/dir/PATH resolution + standalone fixture (0.11.2).

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
