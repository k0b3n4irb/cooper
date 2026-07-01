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

## Distribution (later)

`.vsix` via `@vscode/vsce`; OpenVSX via `ovsx`; optional VSCodium standalone
(preinstalled pack) for branding — a distribution mode, not a re-architecture.

## How to keep this current

When a slice ships: move it to **Done** here, update `status.md`, the README
status table, and `CHANGELOG.md`. When a decision is locked: update the open-Qs
list here and add the entry to `docs/DECISIONS.md`.
