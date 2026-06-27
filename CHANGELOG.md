# Changelog

All notable changes to Cooper are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project uses
[Semantic Versioning](https://semver.org/).

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
