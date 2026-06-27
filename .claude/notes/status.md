# Cooper — current snapshot

_Last updated 2026-06-27._ The full plan (all phases, dependencies, open
decisions) lives in **`roadmap.md`** — this file is just the "now".

## Last shipped

**P0 — Build + preview (C5)** (v0.2.0): `cooper-make` build task (TaskProvider)
+ `cooper-cc` problem matcher, `Cooper: Preview frame` → `luna run --screenshot`
→ inline PNG. First real luna contact. Before it: #3 Configure-clangd + TS
foundation (0.1.0), #2 clangd (0.0.2), #1 WLA-DX highlighting (0.0.1).

**Grounding that reshaped P0:** the pinned luna v1.1.0 is **headless-only** (no
native-window subcommand), so "Run in luna (native window)" is **deferred** until
luna exposes a GUI command. Preview default `--steps 200000` was picked
empirically (lower = black frame on `aim_target.sfc`). See D-013…D-015.

## Current focus

**P2 de-risked 🟢 (2026-06-27).** The pinned luna 1.1.0 **is** a breakpoint
backend today: its live MCP `tools/list` = **17 tools** (not the 8 its stale
`--help` claims), including `run_until_pc`/`run_until_mem_write`/`run_until_mem_read`,
`step`, `poke_memory`. Proven end-to-end (watchpoint → `{hit,pc,value}`, PC
resolved to a `.sym` symbol). **No luna RFE gates P2.** Q1 → design choice (lean:
TS DAP adapter over MCP first). See D-016 + `docs/02` §10.

**In progress: P2.1 — ASM/symbol-level debugger.**
- ✅ **P2.1a (foundation, landed):** `src/sym.ts` (`.sym` parser, label↔addr both
  ways, C symbols) + `src/lunaMcp.ts` (hand-rolled stdio MCP client, zero deps).
  Both pure (no `vscode`), Node-tested end-to-end against the real binary + real
  `.sym` (watchpoint $2100 → PC 0x836B → `InitHardware`). D-017…D-019.
- 🔜 **P2.1b (next):** the `LunaDebugSession` (`@vscode/debugadapter` 1.68 +
  `DebugAdapterInlineImplementation`, D-018) + `contributes.debuggers` `type:luna`
  + a launch config, wiring the foundation into the VS Code debug UI. This is the
  slice that bumps the version and ships a user-facing debugger.

Source-level (P7) still gated on G0 (`wla -i` + `wlalink -S -A`). P1 (helper
polish) can interleave if preferred.

## Foundations in place

TS + esbuild build (`npm run compile`/`watch`/`package`), Node test harness
(`npm test`), `vsce` packaging, WLA grammar generator. Single extension at root;
promote to npm-workspaces when a 2nd package lands.

## Watch items

- Confirm `run_until_pc` / `run_until_mem_write|read` exist in the **pinned**
  luna binary (they're in the source) before relying on them for the debugger.
- Open decisions gating later phases: see `roadmap.md` (Q1 DAP-native, Q4
  tiles wrap-vs-build, Q5 debugger-vs-assets order).
