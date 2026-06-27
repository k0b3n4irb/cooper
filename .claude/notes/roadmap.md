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
- API snippets, Doxygen-sourced hover, `compile_commands.json` generation option.
- Low risk, quality-of-life. Can interleave with P0.

### 🔜 P2 — Debugger, symbol/ASM level (C4) — the jewel, part 1 — **IN PROGRESS**
- DAP adapter over luna: launch, step (`step{1}`), registers/PPU (`state`), memory
  (`peek_memory`/`peek_vram`/`peek_aram`), frame snapshot (`screenshot`),
  breakpoints by address/symbol via `run_until_pc` + the WLA `.sym`.
- ✅ **P2.1a (foundation):** `src/sym.ts` (`.sym` parser) + `src/lunaMcp.ts`
  (stdio MCP client, zero deps) — pure, Node-tested end-to-end (D-017…D-019).
- 🔜 **P2.1b:** `LunaDebugSession` (`@vscode/debugadapter` + inline impl, D-018) +
  `contributes.debuggers` + launch config → the VS Code debug UI.
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

### ⏳ P7 — Source-level debug (C4 + compiler) — the hard part, late
- The debug-info chantier (`docs/03`), built on the author-owned toolchain:
  - **G0** turn on WLA `-i`/`-A` + luna loads the `.sym` → symbolized ASM debug.
  - **G1** cproc emits `dbgloc`/`dbgfile` (thread token loc onto the AST).
  - **G2** w65816 handles `Odbgloc` (QBE core already has the infra).
  - **G3** `.LINE` in wla + emit `.CHANGEFILE`/`.LINE` → native `PC ↔ main.c:line`.
  - **G4** `[frames]`/`[types]` sidecar → typed local variables.
  - **G5** DAP exposes file/line breakpoints, stack trace, variables.
- **Bet to prototype first:** R2 — `.LINE n` in wla survives physical line
  counting (the whole Architecture C depends on it). ~30 lines + a test `.asm`.

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
