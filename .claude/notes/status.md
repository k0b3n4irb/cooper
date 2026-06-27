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

**Next: P1 (helper polish, C3) or P2 (debugger, C4).** Q5 (debugger-first vs
assets-first) is the ordering call. P1 is low-risk quality-of-life; P2 is the
jewel but gated on confirming `run_until_pc`/mem-watch in the pinned binary
(they're **not** in the pinned `luna mcp` catalogue — source-only for now).

## Foundations in place

TS + esbuild build (`npm run compile`/`watch`/`package`), Node test harness
(`npm test`), `vsce` packaging, WLA grammar generator. Single extension at root;
promote to npm-workspaces when a 2nd package lands.

## Watch items

- Confirm `run_until_pc` / `run_until_mem_write|read` exist in the **pinned**
  luna binary (they're in the source) before relying on them for the debugger.
- Open decisions gating later phases: see `roadmap.md` (Q1 DAP-native, Q4
  tiles wrap-vs-build, Q5 debugger-vs-assets order).
