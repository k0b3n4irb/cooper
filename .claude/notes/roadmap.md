# Cooper — roadmap

_Authoritative plan: what's done, what's next, in what order. Last updated
2026-06-27._ Snapshot of "now" lives in `status.md`; the full design behind each
phase is in `docs/01-architecture.md` (§13 phasing) and `docs/03` (debug-info).

Legend: ✅ shipped · 🔜 next · ⏳ planned · 🔒 blocked on a decision

## Done

| Slice | Ver | Delivered |
|---|---|---|
| ✅ #1 — WLA-DX 65816 highlighting (C1b) | 0.0.1 | TextMate grammar from the WLA parser (92 mnemonics + size suffixes, 192 directives + `.END*` catch-all). Verified on the 56-file ASM corpus. |
| ✅ #2 — C support / clangd (C1·C2·C3) | 0.0.2 | Extension pack bundling `vscode-clangd`; `.clangd` recipe mirroring the SDK lint; `int`=2 caveat. Verified 56/56 `main.c` parse clean. |
| ✅ #3 — Configure-clangd + TS foundation | 0.1.0 | `Cooper: Configure clangd` command (SDK detection); TypeScript + esbuild scaffold; pure logic Node-tested. |
| ✅ P0 — Build + preview (C5) | 0.2.0 | `cooper-make` build task (TaskProvider) + `cooper-cc` problem matcher; `Cooper: Preview frame` → `luna run --steps N --force-display --screenshot` → inline PNG. Verified against real luna 1.1.0 + `aim_target.sfc`. **Native-window run deferred** (pinned luna is headless-only). D-013…D-015. |
| ✅ P2.1 — ASM/symbol debugger (C4, MVP) | 0.3.0 | In-process DAP adapter (`LunaDebugSession`, `@vscode/debugadapter`) over luna MCP + `.sym`. Symbol breakpoints (`run_until_pc`), continue/step, Registers scope, symbolized stack. Foundation: `sym.ts` parser + zero-dep `lunaMcp.ts` client. Verified headlessly end-to-end vs real luna (56 tests). D-016…D-019. |
| ✅ Knowledge base | — | `CLAUDE.md` + `.claude/{rules,notes,skills,agents}`, grammar generator. |

## The phased plan (remaining)

Phases follow `docs/01` §13, ordered by value/risk. Each is built with the
`/new-component` discipline (research → ground → decide → verify → commit).

### ✅ P0 — Build + preview (C5) — shipped 0.2.0
- ✅ `cooper-make` build task (TaskProvider) + `cooper-cc` problem matcher.
- ✅ `Cooper: Preview frame` → `luna run --steps N --force-display --screenshot`
  → inline PNG via the built-in image viewer.
- ⏳ **Deferred:** `Cooper: Run in luna` (native window) — the pinned luna v1.1.0
  is **headless-only**; revisit when luna ships a GUI subcommand (author-owned).

### 🔜 P1 — Helper polish (C3)
- ⛔ ~~compile_commands.json command~~ — added 0.9.0, **reverted 0.9.1** (didn't
  earn its complexity; doesn't remove the language-server install). D-026.
- ✅ **Frictionless C onboarding (0.10.0):** auto-write `.clangd` on opening a C
  file (subfolder-aware via the active file's nearest Makefile; picker for
  out-of-tree SDK; never clobbers; opt-out). D-027.
- 🔜 API snippets, Doxygen-sourced hover. Optionally: detect missing clangd and
  surface `clangd: Download language server` proactively.

### ✅ P2.1 — Debugger, symbol/ASM level (C4) — the jewel, part 1 — **SHIPPED 0.3.0**
- ✅ DAP adapter over luna: launch, `step{1}`, Registers scope (`state`), symbol
  (function) breakpoints via `run_until_pc` + the WLA `.sym`, symbolized 1-frame
  stack. `src/sym.ts` + `src/lunaMcp.ts` + `src/lunaDebug.ts`. D-016…D-019.

### P2.2 — Debugger viewers + memory/data breakpoints (C4, part 1b)
- ✅ **P2.2a (0.4.0):** `readMemoryRequest` (CPU-bus hex viewer via `peek_memory`)
  + `evaluateRequest` (symbol/address → byte + memoryReference); register
  memoryReferences. D-020.
- ✅ **P2.2b (0.5.0):** data (memory-watch) breakpoints → `run_until_mem_write|read`
  (`dataBreakpointInfo` + `setDataBreakpoints`); bank-exact; one watch per
  Continue. D-021.
- ✅ **P2.2c (0.6.0):** CGRAM palette viewer (webview at a stop, custom DAP request
  `cooperPpu` off `state.ppu.cgram`; BGR555 decode). Webview verified in the real
  Extension Host. D-023.
- ✅ **OAM sprite viewer (0.7.0):** `Cooper: Show Sprites (OAM)` — 128-sprite table
  from `state.ppu.oam_full`. D-024.
- ✅ **VRAM tile viewer (0.8.0):** `Cooper: Show Tiles (VRAM)` — 512 4bpp tiles from
  `peek_vram` → PNG (zero-dep encoder); verified visually (font glyphs). D-025.
- 🔜 **Viewer polish:** bpp/offset/sub-palette selectors (VRAM); VRAM/ARAM in the
  hex memory view; rendered sprite pixels in OAM; better multi-bp continue.
- **Note:** CGRAM/OAM via the `state` snapshot, VRAM via `peek_vram` — no luna RFE
  was needed for any viewer.
- **Deps RESOLVED (2026-06-27, D-016):** the pinned luna 1.1.0 already exposes
  `run_until_pc`/`run_until_mem_write`/`run_until_mem_read` + `poke_memory` (live
  `tools/list` = 17 tools; its `--help` is stale). Proven end-to-end. **No luna
  RFE gates P2.1.**
- **Decision Q1 (now a design choice, not a capability gate):** DAP-native in luna
  vs TS adapter — **lean: TS DAP adapter over the pinned MCP first**, migrate to
  native `luna dap` later. Lock when P2.1 starts.
- **Known gaps (ergonomics, RFEs not blockers):** no multi-bp continue, no async
  stop-event, no bulk CGRAM/OAM peek, `run_until_pc` returns only `hit`. Mem-watch
  is bank-exact (not mirror-folded). Source-level (P7) still needs G0 build flags.

### ⏳ P3 — Debugger, runtime surface + DAP (C4) — part 2
- luna roadmap: bp/watch posed live, continue/run-until-hit, async stop events,
  poke; then `luna dap` (DAP-native) so any DAP editor debugs SNES games.
- **Deps:** P2; luna changes (author-owned, not a third-party RFE).

### ⏳ P4 — Asset editor: palette (C6, part 1)
- Webview, 15-bit BGR / CGRAM 256 + sub-palettes, round-trip `.pal`, luna preview.
- Cheapest asset editor and the shared brick for tiles+map.

### ⏳ P5 — Asset editors: tiles + map (C6, part 2)
- Tiles (2/4/8bpp, palette-aware) then map (32×32 screens, `SC_*`, flip/priority).
- **Decision 🔒 Q4:** wrap `SNESTilesKitten` vs a webview of our own.

### ⏳ P6 — AI SDK-aware (C7) — the unique differentiator
- L1: ship SDK context to the project (`AGENTS.md`/`CLAUDE.md` template) — quasi
  free, do early. L2: an OpenSNES MCP. L3: the agentic **verify-in-luna** loop
  (write C → build → run → read framebuffer/state → self-correct).

### ✅ P7 — Source-level C debug (C4 + compiler) — SHIPPED 0.14.0 🎯
- The debug-info chantier, via the cheapest real path (D-034/D-035):
  - ✅ **cproc emits `dbgloc <line>`** per statement; **QBE w65816** renders it as a
    `; @cline N` comment (WLA-safe). (Took the comment route, not `.LINE` in wla.)
  - ✅ Build with `wla -i` + `wlalink -A` (Cooper passes them auto) → `.sym`
    addr-to-line; Cooper **joins** asm-line × `@cline` → `PC ↔ main.c:line`.
  - ✅ DAP: frame `source`+`line` (C line highlights), gutter breakpoints → PC.
  - ✅ **C-line stepping** (0.15) — Step Over/Into/Out move by C source line.
  - ✅ **Typed locals (G4)** (0.16) — QBE `-g` no-promote + cproc name/type
    encoding + `; @dbglocal` → a Locals scope reading frame memory, typed.
  - ✅ **Aggregate expansion** (0.17) — cproc `.dbg` sidecar (recursive type
    trees) → structs expand to fields, arrays to elements, nested & typed.
- 🔜 **Remaining:** a release/optimised build toggle (today Cooper builds `-g`);
  pointer-follow (deref a pointer to show the pointee).
- Compiler changes live in the OpenSNES repo (cproc/QBE) — author to commit there.

### ⏳ P8 — Multi-chip debug (C4, advanced)
- SPC700 / SA-1 / GSU as DAP "threads". Big differentiator, optional.

## Cross-cutting decisions still open (from `docs/01` §15)

- **Q1** DAP-native in luna vs TS adapter — **no longer a blocker** (capability
  confirmed, D-016); now a design choice. Lean: TS adapter over MCP first.
- 🔒 **Q4** wrap SNESTilesKitten vs own webview (gates P5).
- **Q5** debugger-first vs assets-first overall ordering (P2 vs P4).
- ✅ **Q6** debug-info form — resolved: extend the WLA `.sym` (`docs/03`).

## The GAME-environment road (agreed 2026-07-06, ordered easy → hard)

C1–C7 make Cooper a *development* environment; this phase makes it a **game**
development environment. Standing rule (user, 2026-07-06): **when a slice needs
a luna or OpenSNES feature that doesn't exist, file an issue on that project**
— confirm the gap live first (run the binary / read the source at the pinned
ref), then link the issue here. Grounding below verified 2026-07-06 vs luna
v1.7.0 + OpenSNES v0.28.0.

### G1 — Run in luna-gui 🎮 (easy)
Play the game in a native window, one click. `luna-gui <rom>` takes the ROM as
argv[1] (verified `luna-gui/src/main.rs:1527`); SDK ≥0.28 ships/detects it
(`opensnes doctor`). Plan: resolve `luna-gui` next to the luna binary (same
dir), `Cooper: Play` command + dashboard button, spawn as sibling process, log
in the Cooper channel. Upstream: none.

### G2 — Viewer selectors + CodeLens (easy)
Old polish leftovers: VRAM viewer bpp/offset/sub-palette selectors; CodeLens
"▶ Debug here · 👁 watch" above C functions (GUI mockup #3). Pure Cooper.
Upstream: none.

### G3 — Watch mode: save → rebuild → refreshed preview (easy-medium)
The edit→see loop. Plan: `cooper.watch` toggle; FileSystemWatcher on
`*.c/*.asm/res/**` → debounce → `make` → refresh the preview panel (and PPU
viewers if open). Headless is enough for v1. v2 (live reload into a RUNNING
luna-gui) needs upstream: **luna issue — reload the loaded ROM in place (or a
`--watch` flag)**; the GUI today reloads only via its file dialog
(`main.rs:369`).

### G4 — Memory map: WRAM/VRAM occupancy (medium)
"Where did my memory go?" Plan: WRAM view from the `.sym` labels/sections
(pure parse, Cooper already holds the `.sym`); VRAM occupancy from luna
`state.ppu` (exposes memory-occupancy stats); render as a bank-map webview.
Upstream: none expected.

### G5 — Input record/replay (medium)
Reproduce gameplay without replaying by hand. Grounded: luna CLI already
**replays** input scripts (`--input "frame:mask,…"`, `parsers.rs:13`); MCP has
`set_joypad` + savestates. Plan v1: Cooper "replay this input script from this
snapshot" (headless, deterministic). v2 (record while playing in luna-gui):
**luna issue — record joypad input to the `frame:mask` script format** (GUI
play → export). Cooper then gets a one-click "record a repro".

### G6 — ROM validation + flashcart deploy (medium, peripheral)
Ship to real hardware. Plan: header/checksum validation first (pure, cheap);
then FXPak/SD2SNES deploy via the existing **usb2snes/QUsb2Snes** protocol
(off-the-shelf client, don't reinvent). Upstream: none (third-party protocol).

### G7 — Frame profiler 📊 (medium-hard, differentiator)
"Where do my scanlines go?" Nobody has this in SNES homebrew. Plan:
`enable_cpu_trace`/`take_cpu_trace` over one frame (verified in v1.7.0,
symbol-annotated once `load_symbols` ran) → aggregate PC samples per function
via the `.sym` → table + per-scanline budget bar (events carry `line`/`mclk`).
Watch the trace-ring cap (`max_events`) — if one frame overflows it:
**luna issue — larger/streaming trace ring or per-frame aggregation**.

### G8 — Sprite workshop: animation + metasprites (hard)
From pixel painter to sprite atelier. Plan: (a) animation preview in the tile
editor (frame strip over the existing sprite-cell grid, play at N fps — pure
webview); (b) metasprite composer (assemble cells into a big sprite, export as
C tables). Ground the table format in `snes/sprite.h` (`oamSet*`) FIRST — if
the lib has no metasprite/animation helper: **OpenSNES issue — metasprite
table + animation player API** (Cooper emits what the lib consumes; never a
Cooper-only format).

### G9 — Gameplay regression tests (hard)
"Record this sequence as a test." Builds on G5. Plan: snapshot + input script +
expected screenshot/WRAM assertions (exactly the SDK's own luna-test baseline
patterns); a `cooper.recordTest` flow writing a `tests/` folder the user's
Makefile can run. Upstream: **OpenSNES issue — expose the luna-test harness
patterns for USER projects** (today they are SDK-internal devtools).

### G10 — Audio 🎵 (hard overall, but v1 is cheap)
The biggest objective hole — a game is half sound. Grounded: the SDK chain
EXISTS (`smconv`, `SOUNDBANK_SRC` (.it) → soundbank in `common.mk`, four
`examples/audio/snesmod_*`). Cooper's role is UX, not a tracker (garde-fou):
- **v1 audition (cheap):** run the ROM in headless luna → `drain_audio` →
  encode `.wav` → play it in a webview. "Hear your game" with zero upstream
  need.
- **v2 tracker round-trip:** `.it` files open in the user's tracker (OpenMPT /
  Schism / Furnace — off-the-shelf); file-watch → `make` regenerates the
  soundbank (rides G3).
- **v3 per-entry SFX audition:** needs a minimal player ROM —
  **OpenSNES issue — soundbank-audition example/template** (play entry N of a
  soundbank), which Cooper then drives via luna.

**Sequence: G1 → G2 → G3 → G4 → G5 → G6 → G7 → G8 → G9 → G10** (G10's v1 can
jump the queue anytime — it's small). File upstream issues the moment a
slice's grounding confirms the gap live, not before.

## Distribution (later)

`.vsix` via `@vscode/vsce`; OpenVSX via `ovsx`; optional VSCodium standalone
(preinstalled pack) for branding — a distribution mode, not a re-architecture.

## How to keep this current

When a slice ships: move it to **Done** here, update `status.md`, the README
status table, and `CHANGELOG.md`. When a decision is locked: update the open-Qs
list here and add the entry to `docs/DECISIONS.md`.
