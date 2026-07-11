# Changelog

All notable changes to Cooper are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project uses
[Semantic Versioning](https://semver.org/).

## [0.56.0] — 2026-07-11

### Added — C support v2: the `int`=2 hover (what clangd can't tell you)

- Hover a plain **`int`** (or **`long`**) in an OpenSNES project's C and Cooper
  now reminds you it's **2 bytes on the SNES, not 4** (`long`: 4, not 8), and
  suggests the fixed-width type (`u16`/`s16`, `u32`/`s32`). clangd runs the host
  target (there is no clang target for the 65816), so it silently mis-sizes plain
  `int`/`long` — this surfaces the truth right where you'd trip on it. **Passive
  by design**: it only adds a hover note (never a diagnostic/squiggle), so it can
  never misfire; it just augments clangd's own hover. Only inside OpenSNES
  projects, and never on the safe fixed-width types or same-size `short`/`char`.

## [0.55.0] — 2026-07-11

### Added — C7: the AI verify loop (`build_and_run`) + complete AI wiring

- **`build_and_run`** — a new tool on Cooper's OpenSNES MCP server that closes the
  loop for an AI assistant: it runs `make` **and** runs the ROM on the luna
  emulator, returning the build errors **or a screenshot of what it renders plus
  PPU/CPU state**. So an AI (Claude Code, Copilot, Cursor…) can *see* what its code
  draws on cycle-accurate hardware and self-correct — the C7 differentiator. Pass
  `input` to drive the joypad and verify gameplay.
- **Both AI servers are now registered.** `Cooper: Configure AI` previously wired
  only the `luna` MCP server; it now also registers the **`opensnes`** server
  (SDK-query tools + `build_and_run`) that was shipped but never hooked up. Your
  AI gets `lookup_api`/`search_api`/`list_headers`/`hardware_constraint` +
  `build_and_run`.
- **AGENTS.md teaches the loop** — query the SDK instead of guessing, call
  `build_and_run`, then self-correct from what you actually see in the frame.

## [0.54.0] — 2026-07-11

### Added — consume luna v1.8 input capture (verified plumbing)

- `LunaMcp` can now drive luna's **v1.8 input capture** end-to-end
  (`startInputCapture`/`takeInputCapture`), returning an engine-authored,
  gui-interoperable, `luna --input`-replayable joypad script — feature-detected
  via `hasTool`, so it lights up only on luna ≥ 1.8 and no-ops on the SDK's v1.7.
  Verified round-trip on v1.8 (Cooper drives input, luna returns the recording)
  and graceful absence on v1.7.
- Honest scope: this is the **foundation**, not a new user command. Grounding
  showed the only v1.8-exclusive capability is capture, and Cooper has no
  interactive luna-driving flow where it's non-redundant today (gameplay tests run
  through the SDK `make test` harness; interactive play is in luna-gui; inline
  `--input` already works on v1.7). The real payoffs — agent-recorded regression
  tests (C7) and gui play-then-capture — consume this once the C7 verify-loop and
  Luna's async stop events land (see `docs/02` §11).

## [0.53.0] — 2026-07-10

### Added — Create New Game gives you a moving hero, not a black screen

- The generated starter now puts a **controllable placeholder character** on a
  genre-tinted backdrop: **New Game → Run → you're already moving something**
  (D-pad), instead of the old blank screen (dogfood friction F3/F13). Each genre
  gets its own flavour from `data/starters.json` — movement (side-scroller vs
  top-down/4-way), backdrop colour, and a next-step hint — and the placeholder
  sprite is wired through the same Add-Sprite pipeline, so you just replace
  `res/hero.png` with your own art (via **Add Sprite**) when you're ready.
  Verified by building rpg/racing/custom to a `.sfc` and, in luna, watching the
  generated hero move (OAM X 120 → 236 holding Right).

## [0.52.0] — 2026-07-09

### Added — luna feature-detection (thin-client hardening) + v1.8 verified

- Cooper now **feature-detects** the connected luna's tool surface: at connect it
  reads `tools/list` and exposes `hasTool(name)`, so optional tools are gated on
  real presence instead of best-effort try/catch. Prompted by the Luna team's
  report (§6): Cooper read `serverInfo.version` but never used it — and that
  string turns out to be the MCP-server crate version (`0.8.5`, identical on luna
  v1.7 and v1.8), not the luna release, so `hasTool` is the only reliable
  capability signal (e.g. `start_input_capture` ⇒ luna ≥ 1.8).
- **Verified against luna v1.8** end-to-end (441 tests green) as well as the
  SDK-bundled **v1.7** — version-agnostic and graceful. Cooper keeps running on
  v1.7 and lights up v1.8 tools when `cooper.lunaPath` points at a v1.8 binary.
  This is the groundwork for consuming v1.8's programmatic input capture and
  `--input @file`, and for the Luna-side engine deliverables (peek_oam, async
  stop events, source-level ingestion, native `luna dap`).

## [0.51.2] — 2026-07-09

### Changed — verified against OpenSNES v0.29.1 (two upstream fixes consumed)

- **SDK pin → v0.29.1**, which lands the two bugs Cooper filed:
  - **#99** (cc65816 `u8` read-modify-write through a pointer misread for structs
    outside page zero). Re-verified the whole two-tier suite on the fixed
    compiler — 438 → 439 green, builds/debug-info/`make test`/luna all intact
    (the `consoleInit` +4-instruction rebaseline changed nothing observable).
  - **#100** (`gfx4snes -T` now emits real 8×8 OAM char-names, not block
    indices). Cooper already computed these itself (0.51.0/0.51.1); now **CI
    cross-checks Cooper's `sheetFrameTiles` against `gfx4snes -T`'s own table**
    (2×2 sheet → 0,2,4,6), so the two can never silently diverge. Cooper keeps
    computing them (pure/offline), validated by the now-authoritative tool.

## [0.51.1] — 2026-07-09

### Fixed — Export Metasprite tile names on non-128px-wide sheets

- **Metasprite `charName` was only correct for a 128px-wide sheet** (the case its
  worked examples were verified against). On any other sheet width the second and
  later cell-rows got wrong OAM tile numbers — because gfx4snes packs cells
  row-major into 16-tile-wide VRAM bands, not by sheet-row. Fixed to the same
  band formula Add Sprite → sheets uses (0.51.0), now the single source of truth,
  and **verified against real gfx4snes output** in CI. A 32px-wide 16px sheet's
  second row is now 4,6 (was 8,10); 128px sheets are unchanged. This closes the
  debt flagged in 0.51.0 — independent of the upstream gfx4snes `-T` fix
  (opensnes#100), which will later let Cooper drop the computation entirely.

## [0.51.0] — 2026-07-08

### Added — Add Sprite now handles multi-frame sheets

- **Cooper: Add Sprite…** now accepts a **sprite sheet**, not just one square
  sprite. Point it at a grid/strip PNG, pick the cell size, and Cooper wires the
  gfx + `data.asm` bridge as before **and** emits a `<name>_tiles[]` array giving
  the correct OAM tile of every frame — so you can `oamSet(id, x, y,
  <name>_tiles[frame], …)` for animation or for several distinct sprites sharing
  one sheet. This kills dogfood #2's friction F8: the frame→tile numbers (which
  jump by the cell's tile-width and wrap across VRAM bands — e.g. frame 8 of a
  16px strip is tile 32, not 16) are **computed for you**, no stride math. The
  formula is verified in CI against real `gfx4snes` output (a 2×2 sheet →
  0,2,4,6; a strip crosses to 32 at frame 8) and a scaffolded sheet is built to
  a `.sfc`. Single square sprites behave exactly as before.

## [0.50.0] — 2026-07-08

### Added — Insert Snippet (a data-driven, CI-compiled snippet library)

- **Cooper: Insert Snippet…** — pick a working, SDK-grounded code snippet; Cooper
  wires the `LIB_MODULES` it needs into the Makefile and drops the code at your
  cursor (adding any missing `#include`s), or hands it back on the clipboard + a
  tab when no C file is open. First category is **Collision** (the SDK
  `collision` module): AABB rect-vs-rect, AABB with push-out (overlap depth), and
  4-corner tile-vs-map collision — the checks every game needs for catching,
  hitting, and walls. The catalogue is plain data (`data/snippets.json`) so it
  grows without a recompile, and **every snippet is compiled against the real SDK
  headers in CI** — an API change is a red test, never a user's broken build.

## [0.49.0] — 2026-07-08

### Added — Add Sound Effect (a WAV → a sound in your game)

- **Cooper: Add Sound Effect…** (right-click a `.wav`) — the audio counterpart
  of Add Sprite, and the answer to dogfood #2's friction F11. It decodes the
  WAV, generates a spec-valid soundbank `.it` (the SDK's `smconv` only ingests
  `.it`), wires `USE_SNESMOD` + `SOUNDBANK_SRC` into the Makefile, and hands you
  the C snippet (`snesmodInit` → `snesmodLoadEffect` → `snesmodPlayEffect`, with
  the "init costs frames" gotcha spelled out). Author a sound anywhere, drop the
  WAV in, Build — you hear it. Cooper owns the sample→`.it`→soundbank bridge; the
  tracker stays external (and the direct-BRR C API is unusable — its PVSnesLib
  ABI is incompatible with cc65816). WAVs above 32 kHz are resampled to the
  SPC's native rate and over-long samples are trimmed (with a notice) to fit
  SPC RAM. Verified by building the authored output (`smconv` emits `SFX_<NAME>`,
  the snesmod snippet links to a `.sfc`) and, live in the dogfood, by luna's DSP
  state showing the voice key on.

## [0.48.0] — 2026-07-08

### Added — Add Sprite (art → on screen, no boilerplate)

- **Cooper: Add Sprite…** (right-click a sprite `.png`) — the answer to the
  dogfood's #1 friction. It converts the PNG (gfx4snes), generates the
  `data.asm` incbin bridge, wires the Makefile, and hands you the C snippet
  (clipboard + a tab) with the **tile number already computed** (via
  `oamInitGfxSet` → tile 0). Paste, Build, and your sprite is on screen — no
  hand-written asm, no `($2100-$2000)/16`. Checks the sprite size against your
  graphics mode and warns if it doesn't fit.

## [0.47.0] — 2026-07-08

### Added — Create New Game (guided)

- **Cooper: Create New Game…** (and a 🎮 button on the empty dashboard) — pick a
  **game type** (platformer, RPG, shmup, fighting, racing, puzzle, adventure, or
  custom); Cooper prefills the SNES profile (BG mode, sprite sizes, library
  modules, sound), you tweak the hardware features with checkboxes, and it
  generates the Makefile + a starter `main.c` for your mode + `.cooper/
  graphics.json`, builds, and opens the project. From "new game" to a booting
  ROM in a few clicks — code-first, nothing hidden.
- Under the hood: a pure project generator verified by **building all eight game
  types** against the real SDK (which caught real linker-module gaps in the
  presets).

## [0.46.0] — 2026-07-08

### Added — graphics mode (the SNES constraint spine)

- **Cooper: Set Graphics Mode…** — pick your game's **BG mode** (each explained
  didactically) and **sprite sizes** (OBSEL pair). Cooper derives what's legal —
  layer count, colours per palette, sprite sizes, VRAM budget — the foundation
  for asset editors that make impossible states unrepresentable. Config is
  hybrid: a default read from your `setMode`/`oamInit` calls, overridable by a
  committed `.cooper/graphics.json`. (First step toward mode-aware editors; the
  editors start enforcing it next.)

## [0.45.0] — 2026-07-07

### Added — metasprite & animation export

- **Cooper: Export Metasprite / Animation (C)…** (right-click a sprite PNG):
  emits a `MetaspriteItem[]` table for a multi-cell sprite with the **correct
  8×8 OAM tile names computed from your sheet geometry** (OpenSNES ≥ 0.29,
  opensnes#97) — what the library asks the editor to compute, and what
  gfx4snes `-T` gets wrong for 16/32px blocks. Optionally emits a matching
  `DECLARE_ANIM_CLIP` for `animPlay`/`animTick`. Verified by compiling the
  generated C against the real SDK headers.

## [0.44.0] — 2026-07-07

### Changed — gameplay tests now use the SDK `make test` harness

- With OpenSNES ≥ 0.29, gameplay tests are **committed and CI-runnable**:
  **Cooper: Record Gameplay Test…** writes a `[tests.<name>]` block into
  **`test/manifest.toml`** (input script + `symbol = hex` assertions) and
  captures the baseline; **Run Gameplay Tests** runs `make test`. The same
  tests run in your own CI. Cooper's private `.cooper-tests/` format is retired
  (input tests now use robust WRAM symbol assertions instead of whole-frame
  comparison). Importing a recording saves to the manifest too.

## [0.43.0] — 2026-07-07

### Added — import a recording (record a repro in one loop)

- **Cooper: Import Recording…** — luna v1.8.0's GUI can now *record* your play
  to a `.input` file; Cooper auto-finds the newest one (or browse) and lets you
  **replay it** at a debug stop or **save it as a gameplay test**. Play until
  the bug, import, done — no script to type.
- CI now builds against **OpenSNES v0.29.0** (the merged animation module,
  user-project `make test` harness, and DW/DL compiler fix — all verified
  before those upstream PRs landed).

## [0.42.0] — 2026-07-07

### Added — gameplay regression tests

- **Cooper: Record Gameplay Test…** — an input script replayed from power-on,
  its final frame saved as a baseline in `.cooper-tests/` (commit it with your
  game). **Cooper: Run Gameplay Tests** replays every test deterministically
  and fails on any framebuffer divergence, showing **expected vs actual** side
  by side. Record a bug repro once, keep it green forever. (The committed
  `make test` format is proposed upstream —
  [opensnes#98](https://github.com/k0b3n4irb/opensnes/issues/98).)

## [0.41.0] — 2026-07-07

### Added — 🎵 hear your game

- **Cooper: Hear the Game…** — renders 3/5/10 seconds of your ROM's audio (the
  SPC's real 32 kHz stereo output) in a headless luna and plays it right in
  the editor; the capture is saved as a `.wav` too. Silent captures are called
  out explicitly instead of leaving you doubting your speakers.

## [0.40.0] — 2026-07-07

### Added — sprite animation preview

- The **tile editor** plays your animation while you draw it: pick a starting
  sprite cell, a frame count and an fps, press ▶ — consecutive cells loop in a
  live preview that updates as you paint. (The metasprite composer is next,
  once the SDK defines the table format —
  [opensnes#97](https://github.com/k0b3n4irb/opensnes/issues/97).)

## [0.39.0] — 2026-07-07

### Added — frame profiler 📊

- **Cooper: Profile One Frame (CPU)** — at a debug stop, traces every
  instruction of the next frame and shows **which functions burn your master
  clocks**: a per-function table (mclk, instructions, %) and a per-scanline
  strip showing *when* in the frame the CPU is busy. Function attribution uses
  your own symbols. A first for SNES homebrew tooling.

## [0.38.0] — 2026-07-07

### Added — ship to real hardware

- **Cooper: Validate ROM** — the internal header checked the way the console
  does: title, checksum ⊕ complement, checksum recomputed from the image, ROM
  size, reset vector, and the 512-byte copier header flashcarts dislike.
- **Cooper: Deploy ROM** — validates, then copies the `.sfc` to your
  flashcart's SD card (`cooper.deployPath`, asked once). usb2snes/FXPak
  over-the-wire deploy will come when it can be verified on hardware.

## [0.37.0] — 2026-07-07

### Added — deterministic input replay

- **Cooper: Replay Inputs…** — at a debug stop, give it `frame:buttons`
  checkpoints (`120:Start, 300:A+Right, 360:0`; a checkpoint holds until the
  next one) and Cooper replays them **from power-on, deterministically**, then
  pauses the debugger at the end — reproduce a gameplay bug with the exact same
  inputs, forever. Button names or raw hex masks; the canonical form is
  compatible with `luna run --input`. Recording while you play is coming via
  [luna#83](https://github.com/k0b3n4irb/luna/issues/83).

## [0.36.0] — 2026-07-07

### Added — memory map

- **Cooper: Show Memory Map** (also in the sidebar) — "where did my memory
  go?": your **WRAM** blocks straight from the linker (exact sizes, mirror
  aliases merged so nothing is double-counted, your variables listed inside
  each block) plus a **VRAM occupancy heatmap** (1 KB per cell, hover for the
  address). Works standalone or at a debug stop.

## [0.35.0] — 2026-07-07

### Added — watch mode (the edit→see loop)

- **Cooper: Toggle Watch** — save a source (`.c`, `.asm`, `res/` PNGs, `.it`
  tracks…) and Cooper quietly rebuilds and refreshes the dashboard preview.
  No terminals popping per save; failures turn the status-bar 👁 red with
  details in the Cooper log. Saves during a build coalesce into one follow-up
  rebuild; generated files (`.c.asm`, `.o`, `.pic`…) never re-trigger the loop.

## [0.34.0] — 2026-07-07

### Added — CodeLens above your functions

- Every project function (the ones that actually made it into the ROM) shows
  **`◉ break · ▶ debug here`** right above its definition in the editor —
  toggle a breakpoint or start debugging at that function in one click. The
  lenses track your breakpoints live. Opt out with the `cooper.codeLens`
  setting. This completes the GUI plan's third mockup (sidebar → dashboard →
  CodeLens).

## [0.33.0] — 2026-07-07

### Added — interactive VRAM viewer

- The **Tiles (VRAM)** viewer gains hardware-exact controls: **bpp 2/4/8**,
  the 16 KB **window offset** into the full 64 KB VRAM, and the
  **sub-palette** (groups of 4/16/256 colours, like the PPU). Every change
  re-renders instantly from the last snapshot — **↻ Re-read VRAM** refreshes
  from the machine. Works at a debug stop and standalone (transient luna).

## [0.32.0] — 2026-07-07

### Added — 🎮 Play your game

- **Cooper: Play (luna-gui)** — one click (sidebar, dashboard, palette) launches
  the built ROM in luna's **native window**: 60 fps, audio, gamepad/keyboard,
  and luna's own interactive debugger (breakpoints, stepping, event viewer).
  The window is independent of VS Code — close the editor, keep playing.
  luna-gui is found next to your `luna` binary (the release zip ships both);
  if it's missing you get the arch-aware download button.

## [0.31.0] — 2026-07-06

### Added — Cooper: New Project…

- **From nothing to a built ROM in one command.** Pick a real SDK example as
  the starting point (`text/hello_world` starred as the minimal starter, or a
  full game like `games/breakout`), a name and a folder: Cooper copies the
  example out of the SDK tree (build artifacts excluded), rewrites its Makefile
  for standalone life (`OPENSNES ?=` your SDK — plain `make` works in a
  terminal too), renames the ROM, writes `.clangd`, **runs the first build**,
  and opens the project ready for Run/Debug.
- The dashboard's empty state and the Get Started walkthrough now offer it.
- Because the starters are the SDK's own examples, they are always current with
  your installed SDK — Cooper embeds no templates that could go stale.

## [0.30.0] — 2026-07-06

### Added — guided onboarding

- **"SDK/luna not found" errors now offer the way out**: a
  **Download (your arch)** button that opens the right prebuilt release for
  your machine (linux x86_64/arm64, Windows x86_64, macOS arm64) plus a jump to
  the setting.
- **SDK version check at debug launch** — if your OpenSNES release predates the
  Cooper debug info (< 0.26), Cooper tells you once (with a download button)
  instead of silently falling back to symbol-level debugging.
- Real screenshots in the guide and walkthrough (a shmup_1942 frame rendered by
  luna; breakout's decoded VRAM tile sheet), and the README status table caught
  up with reality (asset editors + AI are shipped).

## [0.29.0] — 2026-07-06

### Added — "who accesses this address?"

- **Cooper: Trace Memory Accesses (one frame)…** — at a debug stop, give it a
  symbol or address (`frame_count`, `$7E0030`) and it records every read/write
  to it over the next frame, **each attributed to the function that did it**
  (kind, value, PC, scanline, vblank). The classic "why did my variable change?"
  now takes one command. (The watch is bank-exact; the machine advances one
  frame and the debugger refreshes at the new stop.)

## [0.28.0] — 2026-07-06

### Added — disassembly at the stop

- **Cooper: Show Disassembly (at the stop)** — the 65816 instructions at the
  current PC, disassembled by luna itself (correct M/X immediate widths from the
  live flags) and **annotated with your symbols** (`main`, `label+0xNN`), the
  current instruction highlighted.
- The debugger now loads your `.sym` **into luna** at launch, so luna-side
  disassembly and traces know your labels too.

## [0.27.0] — 2026-07-06

### Added — debug snapshots (luna savestates)

- **Cooper: Save Debug Snapshot** captures the whole paused machine (CPU, memory,
  PPU…) to a named snapshot; **Cooper: Restore Debug Snapshot…** jumps straight
  back to it and refreshes the debugger UI at that point — reproduce a bug as
  many times as you need without replaying. Snapshots are ROM-hash-guarded by
  luna (they only load against the same ROM build) and stored per-machine under
  the extension's global storage.

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
