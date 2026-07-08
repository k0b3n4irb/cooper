# Cooper — current snapshot

_Last updated 2026-07-08._ The full plan (all phases, dependencies, open
decisions) lives in **`roadmap.md`** — this file is just the "now".

## Now — the guided-creation onramp + dogfood loop (0.46→0.49)

Executing the vision plan (`.claude/plans/wiggly-bouncing-moon.md`): Cooper =
**code-first guided IDE** (not a no-code clone). Shipped, each grounded + built:
- **0.46 (D-065/066/067):** the mode-driven SNES constraint spine
  (`snesModes.ts`), hybrid graphics config, game-type presets
  (`gameTypes.json`), the **project generator** + **Create New Game** wizard.
- **0.48 (D-068):** **Add Sprite** — art → on screen, tile math handled (kills
  dogfood #1's F1/F2/F4).
- **0.49 (D-069):** **Add Sound Effect** — WAV → `.it` → soundbank + snippet
  (kills dogfood #2's F11). Cooper owns the audio *bridge*, not a tracker.
- **0.50 (D-070):** **Insert Snippet** — the A3 data-driven snippet library
  (`data/snippets.json`), seeded with **Collision** (AABB / push-out / tile).
  Every snippet CI-compiled against the real SDK (anti-drift).
- **Dogfood:** #1 (stardodge) and #2 (**Star Catcher** — original art +
  gameplay + score + original synthesised SFX, verified in luna). Frictions in
  `dogfood-01.md`/`dogfood-02.md` drive the Workshop priority.
- **Next candidates (dogfood-driven):** Add Sprite → multi-frame **sheets** (F7/
  F8); richer per-genre starters (A3); Audio v2 audition/round-trip; mode-aware
  palette/tile/tilemap editors (Phase B).

## Previously shipped

**Upstream dividends wave — the 3 issues Cooper filed are MERGED & released**
(2026-07-07). Tested each develop branch Cooper-side BEFORE opening the PRs
(luna#86 → v1.8.0, opensnes#101 → v0.29.0; both CI-green, verified in logs).
Proven: record→export→deterministic-replay + Cooper-parser compat; debug-info
intact on the new qbe pin (705f79ac); `make test` harness catches a real
injected regression; Cooper 339 Node + 10 integration vs both develop builds.
- **Cooper 0.43.0 (D-062):** `Cooper: Import Recording…` — auto-find the newest
  `~/.local/luna/recordings/*.input`, parse (pure `parseInputFile`, strips `#`
  incl. commented P2), Replay now / Save as gameplay test. CI bumped to
  OpenSNES v0.29.0. Import is pure text + existing replay → no luna>=1.8 runtime
  dep in Cooper (recording happens in luna-gui).
- **Cooper 0.44.0 (D-063):** gameplay tests migrated onto the SDK `make test`
  harness (opensnes#98) — `.cooper-tests/` retired, single committed/CI-runnable
  `test/manifest.toml` format; real e2e catches an injected regression.
- **Cooper 0.45.0 (D-064):** `Export Metasprite / Animation (C)…` — correct 8×8
  OAM char-names from sheet geometry (opensnes#97; avoids gfx4snes -T #100),
  optional DECLARE_ANIM_CLIP. Verified vs SDK worked values + emitted C compiles
  against real headers. Gotcha: anim.h not in umbrella (needs <snes/anim.h>).
- **Wave COMPLETE** — all 3 filed upstream issues (luna#83, opensnes#97/#98)
  merged, released, AND consumed by Cooper (0.43→0.45), each CI-green.
- **Still open / future:** visual metasprite composer for scattered layouts
  (v1 is rectangular-grid); G10 v2/v3 (tracker round-trip, SFX player);
  usb2snes deploy (needs hardware); luna-gui live reload (G3-v2).

**🏁 THE GAME-ENVIRONMENT ROAD IS COMPLETE (G1→G10, 0.32.0 → 0.42.0,
2026-07-07).** Final slice: G9 gameplay regression tests (record input script +
framebuffer baseline into .cooper-tests/, deterministic power-on replay, BYTE
equality — no fuzzy diffing; expected-vs-actual on failure; pure
gameplayTest.ts over an McpLike, whole loop Node-tested vs the real binary;
committed make-test format → **issue opensnes#98**, D-061). Every slice:
grounded → verified vs reality → documented → tag-released with CI confirmed
green in the logs. Open upstream gates: luna#83 (input recording → one-click
repro + G3-v2 live reload), opensnes#97 (metasprite/anim tables → G8b
composer), opensnes#98 (make test → G9 migration); plus G10 v2/v3 (tracker
round-trip, SFX player) and usb2snes (needs hardware). Cooper is at
equilibrium: next wave unblocks on upstream or new user priorities.

**G5→G8 + G10v1 (0.37.0 → 0.41.0, 2026-07-07)** — G5 input replay (frame:mask
scripts, luna --input semantics, behavioral test: target_x clamps at 247;
recording → **issue luna#83**, D-056); G6 ROM validation (checksum w/ mirrored
remainder, prototyped vs 4 real ROMs) + SD deploy (usb2snes deferred: no HW to
verify, D-057); G7 frame profiler (per-function mclk + scanline strip, adapter-
side aggregation, 200k ring holds a frame, D-058); G8a sprite animation preview
in the tile editor (G8b metasprite composer gated on **issue opensnes#97** —
the lib must own the table format, D-059); G10v1 audition (drain_audio → WAV →
webview playback, verified vs the real snesmod_music example, D-060). Gotchas
worth remembering: peek_memory reads \$2000-\$5FFF as 0 by design (pad =
state.cpu_regs.joy1); luna mem-trace interleaves nmi/irq markers; aim_target
init eats ~50 frames. REMAINING on the road: G9 gameplay regression tests
(needs the OpenSNES "luna-test for user projects" issue), G10 v2/v3 (tracker
round-trip; SFX player example), G3-v2 (luna-gui live reload, luna#83-adjacent).

**G1→G4 of the game-environment road (0.32.0 → 0.36.0, 2026-07-07)** — G1 Play
(luna-gui native window, D-051); G2a interactive VRAM viewer (bpp/offset/
sub-palette from a cached snapshot; peek_vram count is u16 → full 64KB = two
32KB reads, D-052); G2b CodeLens '◉ break · ▶ debug here' on .c∩.sym functions
(D-053; integration gotcha: a test opening main.c must run AFTER the .clangd
auto-write test); G3 watch mode (isWatchSource anti-rebuild-loop predicate is
load-bearing — make writes artifacts INTO the watched dir; quiet single-flight
rebuild + dashboard preview refresh + status-bar eye, D-054); G4 memory map
(WRAM ramsections with exact linker sizes, mirror aliases canonicalized/merged
via canonicalWram; VRAM 64×1KB heatmap, D-055). All released via tags (CI +
Release green, verified per version). Next: G5 input record/replay.

**Play (luna-gui) (0.32.0, D-051, G1 of the game-environment road)** — Cooper:
Play spawns the built ROM in luna-gui detached (sidebar/dashboard/palette).
resolveLunaGuiPath: lunaPath folder → sibling of luna → PATH → download toast.
Verified live: breakout 60 fps + audio. NOT CI-testable (GUI needs a display) —
resolution logic is. Next per roadmap: G2 (viewer selectors + CodeLens), G3
(watch mode). Reminder: pushing to main while a CI run is in_progress cancels
it (concurrency cancel-in-progress) — batch pushes or expect a re-run.

**Cooper: New Project (0.31.0, D-050)** — first-mile onboarding: quick-pick a
real SDK example (hello_world starred), copy it out-of-tree (artifact exclusion
mirrors make clean), rewrite Makefile (OPENSNES ?= abs; TARGET/ROM_NAME), write
.clangd, first build BEFORE opening, dashboard-empty-state + walkthrough entry
points. No embedded templates (SDK examples = always-current starters).
Gotchas found in verify: examples/ root has an orchestrator Makefile (walk must
not stop there); vsce secret-scan caught .env → .vscodeignore'd. Next candidates
agreed with user: Run in luna-gui (native window, unblocked by luna v1.7.0),
CodeLens (mockup #3), viewer selectors, frame profiler.

**P0+P1+P2 hardening & luna v1.7.0 dividends** (0.25.0 → 0.30.0, 2026-07-06,
after the full project review in /tmp/cooper-review-2026-07-06.md):
- **CI** (.github/workflows/ci.yml): build+package job + the full two-tier suite
  vs a real SDK build + pinned luna; tool-gated test skips are counted and fail
  CI (COOPER_REQUIRE_TOOLS=1). Live at github.com/k0b3n4irb/cooper (public,
  created 2026-07-06; .env with the gh token is gitignored). Release CI: push a
  v* tag → the .vsix (never committed) publishes as a GitHub release with
  CHANGELOG-extracted notes — v0.30.0 released, CI green (verified in the logs).
  OPENSNES_REF pins the SDK release the suite runs against (v0.28.0, which pins
  luna v1.7.0 — the temporary LUNA_BIN override was removed).
- **Cooper output channel** (Show Log): every make/luna/MCP spawn, timeout and
  error logged; LunaMcp takes onLog (stays pure); luna stderr captured.
- **UX**: cooper.debug/breakOnSymbol/showLog in the palette; dashboard has a
  real "Refresh status" (preview survives via a ready-handshake); preview has a
  30s timeout like the viewers.
- **luna v1.7.0 catalogue exploited** (17→39 MCP tools; pinned binary already
  synced by the SDK): D-045 native multi-bp continue (bp_add/run_until_break —
  the chunked scan and the "first data bp only" warning are GONE); D-046 debug
  snapshots (save/load_state, ROM-hash-guarded, globalStorage/snapshots/);
  D-047 symbol-annotated disassembly viewer (disasm_cpu + load_symbols at
  launch); D-048 one-frame memory trace with function attribution
  (enable/take_mem_trace; luna's nmi/irq context markers must be filtered;
  bank-exact caveat stands).
- **Onboarding** (D-049): arch-aware Download buttons on every SDK/luna-missing
  error; once-per-session warning when the SDK lacks CC65816_G (< 0.26 → symbol
  level only).
- **Vitrine**: real screenshots (shmup_1942 preview, breakout VRAM sheet);
  README status table fixed (C6/C7 were still "planned"). 263 Node + 8
  integration tests.

Watch: luna still has NO raw peek_oam (render_sprite_sheet only), NO async stop
events, and mem watch is bank-exact. User decision 2026-07-06: NOT publishing to
Marketplace/OpenVSX yet — more features first.

## Previously shipped

**AI helper (C7) part 3 — OpenSNES MCP server (C7 COMPLETE)** (v0.24.0). Cooper
ships a hand-rolled JSON-RPC stdio MCP server (dist/opensnes-mcp.js, no new dep —
same protocol as lunaMcp.ts client) exposing the SDK: lookup_api (exact signature +
header + doc), search_api, list_headers, hardware_constraint. Registered via VS
Code MCP-provider API (feature-detected + any-cast → engines stays ^1.75; no-op on
old VS Code). Pure opensnesApi.ts + opensnesMcp.ts handleMessage, tested vs the real
SDK. C7 done: context (AGENTS.md) + luna MCP + OpenSNES MCP → the AI writes C →
build → run in luna → observe → self-correct. 228 Node + 8 integration. D-044.
**All headline capabilities (C1–C7) shipped.**

**AI helper (C7) part 2 — register luna as MCP** (v0.23.0). Cooper: Configure AI
now also writes .vscode/mcp.json (key servers, Copilot) + .mcp.json (key mcpServers,
Claude Code/Cursor) registering `luna mcp`, merging into existing config (skips
unparseable). Chose files over the extension mcpServerDefinitionProviders API to
keep engines ^1.75 (API needs ~1.101). Pure mcpConfig.ts (mergeVscodeMcp/
mergeProjectMcp). 218 Node + 8 integration. D-043. Next C7: (3) OpenSNES MCP +
build→luna verify loop.

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

**🎮 The guided creation flow + mode-driven SNES-perfect editors** (Phase A→B of
the vision, `roadmap.md`; user direction 2026-07-08). Positioning locked:
**code-first + guided, NOT a no-code GB Studio clone** — lower the ramp
(wizard/presets/snippets/constraints) without hiding code or capping the ceiling.
- ✅ **Constraint spine** (`snesModes.ts`, D-065) + hybrid config
  (`graphicsConfig.ts`, `Set Graphics Mode…`).
- ✅ **Game-type presets** (`data/gameTypes.json`, D-066) + **project generator**
  (`projectGen.ts`) + **`Create New Game…`** wizard (D-067). Generator verified
  by building all 8 game types.
- 🔜 **A3** starter/snippet library (data-driven, CI-compiled).
- 🔜 **B** palette/tile editors go mode-aware; then the tilemap editor
  (supersedes D-042).
- ▶ **Dogfood** a real small game in parallel — reality prioritises the Workshop.

North star: **open Cooper → guided to a running game → grows into a real
toolchain.** See [[cooper-simplicity-over-features]].

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
