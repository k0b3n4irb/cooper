# Changelog

All notable changes to Cooper are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project uses
[Semantic Versioning](https://semver.org/).

## [0.26.0] — 2026-07-06

### Changed — native multi-breakpoint continue (luna v1.7.0)

- **All your breakpoints are honored in a single Continue** — function
  breakpoints, source-line breakpoints and data watchpoints together, at full
  emulation speed. Cooper now mirrors them into luna's native breakpoint
  registry (`bp_add`, luna ≥ 1.6) and runs one `run_until_break`. Gone: the
  "luna watches one address per run — only the first data breakpoint is honored"
  warning, and the slow chunked scan used when you had several breakpoints
  (which could overshoot the exact instruction).
- Watchpoint stops now print what fired in the Debug Console:
  `watchpoint: write $002100 = 143 (PC $00836B)`.

## [0.25.0] — 2026-07-06

### Added — the Cooper log (diagnosability)

- New **Cooper** output channel (**Cooper: Show Log** / View → Output → Cooper):
  every `make` invocation, luna spawn, MCP call, timeout and surfaced error is
  logged with timestamps — "nothing happens" is now always diagnosable. luna's
  stderr is captured into the log too (both the debugger's emulator and the
  transient viewer runs).
- **Cooper: Debug (luna)** and **Cooper: Toggle Breakpoint on Function…** are now
  in the Command Palette (they existed but weren't contributed). The breakpoint
  command picks the function from your project's symbols when invoked from the
  palette.
- CI (GitHub Actions): build + package on every push, plus the full two-tier
  suite against a real SDK build and the pinned luna. Tool-gated test skips are
  now counted and fail the run in CI (`COOPER_REQUIRE_TOOLS=1`).

### Fixed

- **Preview timeout** — a wedged luna preview now errors after 30 s instead of
  spinning forever (same guard the PPU viewers got in 0.24.2).
- **Dashboard "Refresh"** — the button under the preview (which re-renders the
  frame) is now labelled **Update preview**; a real **Refresh status** button
  re-reads the SDK/luna/ROM status without re-running anything, and the preview
  image survives the refresh.

## [0.24.2] — 2026-07-05

### Fixed — PPU viewers never hang silently; safer startup

- The standalone PPU viewers (Palette / Sprites / Tiles) could hang with an
  invisible status-bar spinner if luna didn't respond. Now they show a visible
  **notification**, have a **25 s timeout**, and always surface a clear error
  (ROM not built, `cooper.lunaPath` unset, or luna timed out) instead of doing
  nothing.
- Removed the experimental VS Code MCP-provider auto-registration (`contributes.
  mcpServerDefinitionProviders` + `vscode.lm` call) added in 0.24.0. The OpenSNES
  MCP server still ships (`dist/opensnes-mcp.js`) and is configured via the file
  approach (`.vscode/mcp.json` / `.mcp.json`) like luna — no dependency on a
  recent, unstable VS Code API.

## [0.24.1] — 2026-07-05

### Fixed — PPU viewers (Palette / Sprites / Tiles) work without a debug session

- Opening **Palette / Sprites / Tiles** from the dashboard or sidebar no longer
  errors with *"start a Luna debug session first"*. If a debug session is paused
  they show the **live** PPU at that stop (as before); otherwise Cooper runs the
  built ROM to a frame in a **transient luna** (like Preview) and shows that — so
  the viewers work standalone. (If the ROM isn't built, it says so.)

## [0.24.0] — 2026-07-04

### Added — AI helper (C7) part 3: the OpenSNES MCP server (C7 complete)

- Cooper now ships an **OpenSNES MCP server** and registers it with your assistant,
  so the AI can query the **installed SDK** directly:
  - `lookup_api` — a function/macro's exact signature + header + doc comment;
  - `search_api` — find symbols by substring; `list_headers`;
  - `hardware_constraint` — the SNES rules host intuition gets wrong.
  This beats the static `AGENTS.md`: it always matches the user's actual SDK.
- Hand-rolled JSON-RPC stdio server (**no new dependency**), bundled to
  `dist/opensnes-mcp.js`, registered via VS Code's MCP-provider API
  (feature-detected — no `engines` bump; a no-op on older VS Code). D-044.
- **C7 is complete:** context (AGENTS.md) + luna MCP (drive/verify) + OpenSNES MCP
  (query the SDK) → the AI writes C, builds, runs in luna, and self-corrects.

## [0.23.0] — 2026-07-04

### Added — AI helper (C7) part 2: register luna as an MCP server

- **Cooper: Configure AI** now also registers **luna as an MCP server** for your
  assistant — it writes `.vscode/mcp.json` (VS Code / Copilot, key `servers`) and
  `.mcp.json` (Claude Code / Cursor, key `mcpServers`), merging into any existing
  config (a config it can't parse is left untouched). Your AI can then drive the
  emulator — peek VRAM/memory, read state, screenshot, run to a PC — to **verify
  its own changes on cycle-accurate hardware**.
- File-based on purpose (works on any VS Code + any assistant, no `engines` bump).
  D-043.

## [0.22.0] — 2026-07-04

### Added — AI helper (C7) part 1: ship OpenSNES context

- **Cooper: Configure AI (OpenSNES context)** writes an **`AGENTS.md`** (+ a
  `.github/copilot-instructions.md` pointer) into your project, so any AI assistant
  that reads them (Copilot, Claude Code, Cursor…) becomes **OpenSNES-expert**: the
  `int`=2 caveat, BGR555/CGRAM rules, sprite sizes, tilemap format, the
  build/run/luna workflow, and "verify in luna, not by reasoning".
- Grounded, current MCP/assistant facts captured for the next slices (register
  luna's MCP via the VS Code extension API; an OpenSNES MCP). D-043.

## [0.21.1] — 2026-07-04

### Improved — tile editor: undo / redo

- The tile/sprite editor now has **undo / redo** (buttons + **Ctrl/Cmd+Z** and
  **Ctrl/Cmd+Shift+Z** / **Ctrl+Y**) — one history entry per paint stroke.

## [0.21.0] — 2026-07-04

### Added — Tilemap viewer (hardware-accurate, not a Tiled clone)

- **View a `.map` assembled the way the SNES draws it.** Right-click a `.map` →
  **View Tilemap (assembled)** (or *Cooper: View Tilemap*): Cooper reads the
  gfx4snes `.map` + `.pic` tileset + `.pal`, and paints the full background
  applying the real per-cell 16-bit attributes — **sub-palette and H/V flip** —
  which Tiled doesn't render hardware-faithfully.
- **Not an editor:** tilemap *authoring* is Tiled (which the SDK already
  integrates via `tmx2snes`); cloning it would be debt. Cooper adds the SNES-truth
  *viewer* instead. Verified end-to-end (the mode1 example assembles to its exact
  background). D-042.

## [0.20.0] — 2026-07-04

### Added — SNES tile/sprite editor (asset editors, C6)

- **Paint an indexed PNG's pixels.** Right-click a `.png` → **Edit Tiles /
  Sprites** (or *Cooper: Edit Tiles / Sprites*): a zoomable paint grid with an
  **8×8 tile overlay** and a selectable **sprite-cell** guide (8/16/32/64 — the
  SNES square sizes). Pick a colour from the palette strip, paint, **Save to
  PNG** → **Build** regenerates the `.pic`.
- Cooper now round-trips pixels through the PNG: `writeIndexedPixels` re-encodes
  IDAT (filter None + zlib), keeping IHDR/PLTE. Verified end-to-end — a painted
  PNG is accepted by `gfx4snes` and round-trips exactly. D-041.

## [0.19.1] — 2026-07-04

### Improved — palette editor: live sprite preview + bpp selector

- The palette editor now shows a **live preview of the actual image**, recoloured
  as you drag the sliders (WYSIWYG) — Cooper decodes the indexed PNG's pixels
  (`readIndexedPixels`: inflate + unfilter + unpack 1/2/4/8-bit indices).
- A **sub-palette size selector** (4 / 16 / 256 = 2bpp / 4bpp / 8bpp) lays the
  swatches out to match the target depth.

## [0.19.0] — 2026-07-02

### Added — SNES palette editor (asset editors, C6)

- **Edit a sprite/BG palette in true SNES colours.** Right-click an indexed
  `.png` (or run **Cooper: Edit Palette**) to open a **BGR555** editor: each
  channel is 0–31 (the real 15-bit SNES gamut), rows of 16 mark the sub-palettes,
  entry 0 is transparent. Save writes the PNG's palette (`PLTE`) back — **Build
  regenerates the `.pal`** (the editor edits the *source* the SDK's `gfx4snes`
  consumes; conversion stays in the build).
- Grounded in the SDK: the BGR555 conversion is **byte-identical to `gfx4snes`**
  (verified against a real asset's `.pal`). D-040.

## [0.18.0] — 2026-07-02

### Changed — Release vs debug builds

- **Build and Run/Preview now produce a release build** — plain `make`, no debug
  flags — so the ROM you preview is byte-identical to the one you ship. (Debug
  metadata perturbs codegen, so it must not leak into a normal build.)
- **Debug (F5) builds with `-g` automatically** (`wla -i` / `wlalink -A` +
  `CC65816_G=1`) right before launching — source-level info is always present and
  you no longer need to Build first. Build/Run stay release. D-039.

## [0.17.2] — 2026-07-01

### Docs — new-user onboarding (download, don't compile)

- User Guide §1 and the in-editor walkthrough now tell a newcomer to **download
  the prebuilt SDK/emulator for their architecture and unzip** — no compilation
  (matches OpenSNES `GETTING_STARTED`): the OpenSNES release zip per platform
  (`…_linux_x86_64.zip`, `…_linux_arm64.zip`, `…_darwin_arm64.zip`,
  `…_windows_x86_64.zip`) from its GitHub Releases, **luna** from its releases,
  clangd one-click via the bundled extension. Only `make` + a text editor needed.
- Documented that **source-level C debugging** needs an OpenSNES release including
  Cooper debug info; older releases fall back to symbol/register level.
- (Supersedes the 0.17.1 wording, which wrongly said to build from source.)

## [0.17.0] — 2026-07-01

### Added — Aggregate expansion (structs & arrays) in Locals

- **Struct and array locals now expand** in the Variables pane: click a `struct`
  to see its named fields (typed, at their offsets), an array to see its elements
  (`[0]`, `[1]`…). Nested structs/arrays expand recursively.
- How: cproc writes a `.dbg` sidecar with each aggregate local's recursive type
  tree (`g8{init:p4@0;update:p4@4;}`, `a20[u2;10]`); Cooper joins it with the
  `@dbglocal` frame offset and reads each field/element from memory, typed.
- Arrays are capped at 256 elements in the pane. D-038.

## [0.16.0] — 2026-06-30

### Added — Typed local variables (G4)

- **The Variables pane now shows a "Locals" scope** with the current function's C
  variables — `pad`, `dx`, `cfg`… — read live from the stack frame and **typed**
  (`u16`, `s16`, pointer, `struct`). Not just registers anymore.
- How: a new `-g` mode in QBE keeps C locals memory-resident (suppresses
  `promote()`); cproc encodes each local's name+type into its alloc temp; the
  w65816 backend emits `; @dbglocal <name> <offset>`; Cooper joins them and reads
  `frameBase + offset` at a stop. Cooper builds pass `CC65816_G=1` automatically.
- Requires the patched cproc/QBE (OpenSNES repo). Frame base = SP at a stop
  (statement boundary); aggregates show raw bytes for now. D-037.

## [0.15.0] — 2026-06-29

### Added — C-line stepping

- **Step Over / Into / Out now advance a whole C source line**, not one CPU
  instruction. *Step Over* skips subroutine calls wholesale (via `run_until_pc`);
  *Step Out* runs until the current function returns; *Into* stops at the first new
  line. Falls back to instruction-level when there's no C-line info at the PC.
  Pure decision logic (`callLen`, `stepStops`) is unit-tested; verified end-to-end
  (a Step Over advances to a different `main.c` line). D-036.

## [0.14.0] — 2026-06-29

### Added — Source-level C debugging (the jewel) 🎯

- **Your `main.c` line now highlights when you stop**, and you can **set
  breakpoints in the C gutter** — not just by symbol. Continue lands on real C
  lines; the call stack shows `main.c:line`.
- How: the patched `cc65816`/QBE emit per-statement line markers; built with
  `wla -i` / `wlalink -A` the `.sym` carries PC→line; Cooper joins them to map
  PC ↔ `main.c`:line. The luna adapter sets the frame `source` and resolves gutter
  breakpoints to PCs via `run_until_pc`. Cooper passes the debug-info flags
  automatically — just Build & Debug.
- Requires a compiler built from the patched cproc/QBE (OpenSNES repo); the
  `.sym`/asm additions are harmless to the ROM. D-034, D-035.

## [0.13.0] — 2026-06-29

### Added — In-editor "Get Started" walkthrough

- A graphical onboarding (VS Code's Welcome / Get Started) that walks you through
  **point at your tools → open the panel → build → run → debug → inspect the PPU**,
  with screenshots and one-click buttons; steps check off as you do them. Open it
  any time from the Cooper panel header (🎓) or **Cooper: Get Started**.
- Pure manifest (`contributes.walkthroughs`) + media bundled under `media/`. D-033.

## [0.12.3] — 2026-06-29

### Fixed — Symbol breakpoints no longer pile up

- Clicking a function under **SYMBOLS** now **toggles** its breakpoint (click again
  to remove) instead of adding a duplicate every time. Verified in the Extension
  Host. Also added a regression test that the debugger's VARIABLES → Registers
  chain (threads → stackTrace → scopes → variables) returns the CPU registers.

## [0.12.2] — 2026-06-28

### Changed — `program` is now optional in the luna launch config

- A luna `launch.json` no longer needs a hardcoded `program`. If omitted, Cooper
  resolves the ROM from the project's Makefile `TARGET` every launch — so it stays
  correct when you restructure the project. The default config and snippet drop
  `program`; set it only to pin a specific ROM.

## [0.12.1] — 2026-06-28

### Fixed — Debug starts even with a stale launch.json

- **"Nothing happens on F5/Debug" when `launch.json` pointed at an old ROM path**
  (e.g. after restructuring the project). The luna debug-config provider now uses
  a configured `program` only if it **exists**, and otherwise **re-resolves the
  ROM from the project** (subfolder-aware) — debugging self-heals. Verified
  end-to-end against a user luna **1.3.0** release + their game (breakpoint hits
  exactly). D-032.

## [0.12.0] — 2026-06-28

### Added — The Cooper dashboard ("Home")

- A graphical **Cooper: Home** webview: big **Build / Run / Debug** buttons, a
  **live preview thumbnail** (click Run to render a frame), and **Palette /
  Sprites / Tiles** cards, plus an SDK / luna / ROM status line. Open it from the
  **🏠 button** in the Cooper sidebar header (or `Cooper: Open Dashboard`).
- Themed with VS Code colors so it matches your theme; interactive via a strict
  CSP (nonce-gated script). Reuses the existing commands — no new backend. D-031.

## [0.11.2] — 2026-06-28

### Fixed — Run/Debug finds luna even from a separate user release

- **`cooper.lunaPath` may now be the binary OR the folder that contains it** (a
  luna user release unzips to a folder with `luna`/`luna-gui`). Cooper also falls
  back to `luna` on your PATH. Fixes "luna not found" when the path was a directory.
  D-030.

### Internal

- Test against a real **standalone (out-of-tree) project fixture**, not only the
  SDK's in-tree examples — so build/luna issues surface in CI, not in your editor.

## [0.11.1] — 2026-06-28

### Fixed — Build works for standalone projects (not just SDK examples)

- **Build no longer fails with `…/make/common.mk: No such file or directory`** for
  a project outside the SDK tree. Cooper now runs **`make OPENSNES=<your SDK>`**
  (from `cooper.opensnesPath`), overriding the Makefile's `$(shell cd ../../..)`
  guess — so your game can live in its own repo with OpenSNES installed elsewhere.
  The build also runs in the **project's directory** (subfolder-aware). D-029.

## [0.11.0] — 2026-06-28

### Added — The Cooper sidebar (graphical, clickable — no more palette hunting)

- A **Cooper icon in the activity bar** opens a tree with everything one click away:
  - **PROJECT** — the ROM (with ✓ built status) and the detected SDK.
  - **BUILD & RUN** — Build, Run / Preview, Debug.
  - **PPU VIEWERS** — Palette, Sprites (OAM), Tiles (VRAM).
  - **SYMBOLS** — *your* functions (parsed from your `.c` and matched to the
    `.sym`); **click one to set a breakpoint** on it.
- **Debug** from the tree launches luna with the right ROM even for projects in a
  **subfolder** (no launch.json needed). A refresh button keeps it current.
- First step of the GUI layer (sidebar; a webview dashboard + CodeLens come next).
  D-028.

## [0.10.0] — 2026-06-28

### Added — Zero-step C support: auto-`.clangd` on open

- Open a C file in an OpenSNES project and Cooper **writes the `.clangd`
  automatically** — no command to run. C IntelliSense (completion, hover,
  go-to-definition on `#define ENEMY_SPEED 2`, …) works as soon as clangd is
  installed (one click: `clangd: Download language server`).
- Resolves the project from the **active file's nearest Makefile**, so projects in
  a **subfolder** work; for **out-of-tree** projects, a single picker sets the SDK
  path. Never overwrites an existing `.clangd`; opt out with
  `cooper.autoConfigureClangd: false`. (D-027.)

## [0.9.1] — 2026-06-28

### Removed

- **`Cooper: Generate compile_commands.json`** — reverted. It was justified as an
  "engine-agnostic" alternative to clangd, but it does **not** remove the need for
  a language server (cpptools also requires an install), so it only added a second
  config surface and confusion. C support stays a **single** path: `.clangd` via
  `Cooper: Configure clangd`. (Reverses D-026.)

## [0.9.0] — 2026-06-28

### Added — `Cooper: Generate compile_commands.json` (P1 / C3) — _reverted in 0.9.1_

- Writes a JSON Compilation Database (one entry per `.c` file) using the same
  flags as the `.clangd` config (SDK include + `-std=gnu11` + the `-Wno-*`
  mirror). **Engine-agnostic**: clangd auto-discovers it; the MS C/C++ extension
  reads it via `C_Cpp.default.compileCommands` — so you can use either LSP and get
  diagnostics that match the build's clang lint (D-026).
- Verified by running the emitted command through `clang` (close-the-loop) and by
  generating a real file in the Extension Host integration tier.

## [0.8.0] — 2026-06-28

### Added — Debugger VRAM tile viewer (P2.2c)

- **`Cooper: Show Tiles (VRAM)`** — a webview tile sheet of the live VRAM at the
  current debug stop: the first 512 4bpp tiles (16/row), decoded from `peek_vram`
  (new `cooperVram` custom request) and coloured with CGRAM sub-palette 0.
- Pure planar tile decode + a **zero-dependency PNG encoder** (RGBA via the Node
  `zlib` builtin) in `src/tiles.ts`; rendered as a PNG `<img>` (no webview JS).
- Verified including **visually** — a PNG built from aim_target's live VRAM shows
  recognisable font glyphs (D-025). Both test tiers green.

## [0.7.0] — 2026-06-28

### Added — Debugger OAM sprite viewer (P2.2c)

- **`Cooper: Show Sprites (OAM)`** — a webview table of the 128 OAM sprites at the
  current debug stop (X, Y, tile, palette, priority, flips, size; on-screen rows
  highlighted), decoded from `state.ppu.oam_full` via the `cooperPpu` custom
  request. Grounded on aim_target (sprite 0 = the player at X=124 Y=107). Same
  decode-pure + webview pattern as the palette viewer (D-024). Verified both tiers.

## [0.6.0] — 2026-06-28

### Added — Debugger palette viewer (P2.2c)

- **`Cooper: Show Palette (CGRAM)`** — a webview showing the **live 256-colour
  palette at the current debug stop** (16×16 swatch grid), decoded from luna's
  `state.ppu.cgram` (15-bit BGR555 → RGB). Data flows through a custom DAP request
  (`cooperPpu`) on the active luna session, so it reflects exactly what the PPU
  holds where you paused.
- Works around the lack of an MCP `peek_cgram` tool by reading `state.ppu.cgram`
  directly (D-023). Pure decode in `src/ppu.ts`; webview wiring verified in the
  real Extension Host (integration tier).

### Tooling

- **VS Code integration-test harness** (`@vscode/test-cli` + `@vscode/test-electron`,
  D-022): `npm run test:integration` runs `src/test/*.test.ts` inside a real
  Extension Development Host — verifies command registration, the luna debug
  adapter end-to-end (a DAP tracker observes a `stopped(entry)` event), and the
  palette webview command. Complements the fast Node tier (`npm test`).

## [0.5.0] — 2026-06-27

### Added — Data (memory-watch) breakpoints (P2.2b)

The debugger's differentiator: **stop when a memory address is read/written**,
over luna's `run_until_mem_write`/`run_until_mem_read`.

- `dataBreakpointInfoRequest` + `setDataBreakpointsRequest`: set a watch on a
  `.sym` symbol (e.g. `vblank_flag`) or a literal address (`$2100`). Registers
  aren't watchable (return no `dataId`).
- Continue honours a single watch exactly via `run_until_mem_*`; `'readWrite'`
  watches writes. Capability `supportsDataBreakpoints`.
- Verified end-to-end vs real luna: a write watch on `$2100` stops at PC `0x836B`
  inside `InitHardware` — the exact instruction that writes INIDISP.

### Notes / limits

- luna watches **one address per run** (D-016): when a data breakpoint coexists
  with other breakpoints, only the first is honoured per Continue (warned).
  Mem-watch is **bank-exact** — set the address in the executing bank (`$80:..`
  FastROM, `$00:..` LoROM). Decision D-021.

## [0.4.0] — 2026-06-27

### Added — Debugger memory view + expression evaluation (P2.2a)

- **`Read Memory` (hex viewer)** — `readMemoryRequest` reads CPU-bus memory
  (WRAM / ROM / MMIO) via luna `peek_memory`. Open it from a register's
  "View Binary Data" or any evaluated address.
- **Watch / hover / REPL evaluation** — `evaluateRequest` resolves a `.sym`
  symbol (e.g. `vblank_flag`) or a literal address (`$7E0030`, `0x008365`,
  `7E:0030`) to its first byte and a clickable `memoryReference`.
- **Registers carry `memoryReference`s** (PC at PB:PC; 16-bit regs at bank 0) so
  the hex viewer can open at a register's value.
- Capabilities: `supportsReadMemoryRequest`, `supportsEvaluateForHovers`.
- Verified end-to-end vs the real luna 1.1.0 binary: `evaluate("InitHardware")`
  → `0x008365`/`$C2`; `readMemory(0x008365, 3)` → the real opcodes `C2 10 E2`.

### Notes / limits

- Memory reads cover the **CPU bus** only. VRAM / ARAM (`peek_vram`/`peek_aram`)
  need a separate memory-reference scheme (P2.2b); CGRAM / OAM have no MCP peek
  in the pinned binary (D-016). Decision D-020.

## [0.3.0] — 2026-06-27

### Added — Component #4: ASM/symbol-level debugger (P2.1, the jewel — MVP)

A working SNES debugger over the luna emulator, in-process (no external adapter
binary). Pick **"Luna: Debug SNES ROM"** / F5 on a built `.sfc`.

- **`contributes.debuggers` `type: "luna"`** wired via a
  `DebugAdapterInlineImplementation` + a `DebugConfigurationProvider` that
  resolves the ROM (project Makefile `TARGET`) and the luna binary.
- **`src/lunaDebug.ts` — `LunaDebugSession`** (`@vscode/debugadapter` 1.68):
  launch + stop-on-entry, **symbol (function) breakpoints** (`InitHardware` →
  `.sym` → `run_until_pc`), continue, single-instruction step, a **Registers**
  scope (A/X/Y/SP/PC/PB/DB/DP, P decoded to `nvmxdizc`, E) from luna `state`, and
  a one-frame call stack naming the current PC's symbol.
- **Foundation (P2.1a):** `src/sym.ts` (WLA `.sym` parser, label↔address both
  ways incl. C symbols) + `src/lunaMcp.ts` (hand-rolled stdio JSON-RPC client for
  `luna mcp`, **zero deps** — D-017).
- **Verified end-to-end headlessly against the real luna 1.1.0 binary:** the full
  DAP loop (initialize → launch → symbol breakpoint → continue → stop in
  `InitHardware` → registers show `PC=$00:8365`) plus a `run_until_mem_write`
  watchpoint resolving its hit PC through the `.sym`.

### Notes / limits (next slices)

- Breakpoints are **by symbol name** (no source/instruction breakpoints yet — no
  line↔PC until G0, no disassembler). Multiple breakpoints use a chunked-step
  scan (may overshoot); a single breakpoint is exact. Memory view + data
  breakpoints (`run_until_mem_*`) and PPU/VRAM viewers come next (P2.2).
- Decisions D-016…D-019. New deps: `@vscode/debugadapter`,
  `@vscode/debugprotocol` (bundled into `dist/`; the `.vsix` stays self-contained).

## [0.2.0] — 2026-06-27

### Added

- **Component #4 (P0): Build + preview.**
  - **`make` build task** contributed via a `TaskProvider` (`cooper-make` type):
    a `build` task (default goal) and a `clean` task, discoverable in *Run Task*.
    `Cooper: Build (make)` runs the build directly.
  - **`cooper-cc` problem matcher** turns `cc65816`/clang `file:line:col:
    severity: message` errors into Problems-panel entries (bound to the build
    task). Verified by capturing a real `cc65816` error.
  - **`Cooper: Preview frame`** renders the built ROM headlessly with
    `luna run --steps N --force-display --screenshot` and opens the PNG in the
    built-in image viewer. Verified end-to-end against the real luna 1.1.0 binary
    and `aim_target.sfc` (non-black 256×224 frame).
  - new settings: `cooper.lunaPath`, `cooper.preview.steps` (default 200000,
    grounded empirically), `cooper.preview.forceDisplay` (default true).

### Notes

- The pinned luna binary (v1.1.0) is **headless-only** — it has no native-window
  subcommand, so "Run in luna (native window)" is deferred until luna exposes a
  GUI command. The preview is the architecturally-correct snapshot path. See
  `docs/DECISIONS.md` D-013…D-015.

### Fixed

- `.vscodeignore` now excludes `.claude/`, `scripts/`, and `CLAUDE.md` from the
  packaged `.vsix` (dev-only files).
- Corrected the stale "missing `lib/include/snes/snes.h`" wording in the
  Configure-clangd error path (the sentinel is `lib/include/snes.h`).

## [0.1.0] — 2026-06-26

### Added

- **Component #3: `Cooper: Configure clangd` command** — generates the `.clangd`
  for the current OpenSNES project automatically:
  - SDK-path detection: `cooper.opensnesPath` setting → project Makefile's
    `OPENSNES` line → upward search for `lib/include/snes.h` → folder picker.
  - new setting `cooper.opensnesPath` (machine-overridable).
- **TypeScript + esbuild foundation** (first runtime code): `src/`, `tsconfig.json`,
  `esbuild.js`, build/watch/package scripts. The pure config/detection logic
  lives in `src/clangdConfig.ts` (no `vscode` import) and is unit-tested under
  Node (`test/run.js`).

### Verified

- `tsc --noEmit` + esbuild bundle clean; packages with vsce (`cooper-0.1.0`).
- 10/10 node assertions on the pure module, including a closing-the-loop check:
  `clang` parses `hello_world` using the flags the generator actually emits.

## [0.0.2] — 2026-06-26

### Added

- **Component #2: C language support (clangd).** Cooper becomes an extension pack
  that installs the official `llvm-vs-code-extensions.vscode-clangd` extension,
  and provides the OpenSNES clangd configuration:
  - `.clangd` recipe mirroring the SDK's own `clang -fsyntax-only` lint flags
    (`-I lib/include -I . -std=gnu11` + warning suppressions), documented in
    `docs/clangd.md`.
  - Honest `int`=2 caveat: clangd's host target reports `int` as 4 bytes; the
    `cc65816` build is the authority. Fixed-width types (`u8`/`u16`/…) are safe.
  - Verified: these flags parse the entire example corpus (56/56 `main.c`) clean.

## [0.0.1] — 2026-06-26

### Added

- **Component #1: WLA-DX 65816 assembly language support.** Syntax highlighting
  for `.asm`/`.inc` files in the WLA-DX dialect used by OpenSNES:
  - WDC 65816 instruction set (92 mnemonics),
  - 200 WLA-DX directives (generated from the assembler's own parser), case-insensitive,
  - `$hex`/`%binary`/decimal literals, `;` comments, `"`/`'` strings, column-0
    labels, indexed registers.
  - Language configuration (line comment, brackets, auto-closing pairs).
- Project foundation: repo, MIT license, architecture docs under `docs/`.
