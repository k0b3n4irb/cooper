# Cooper — current snapshot

_Last updated 2026-06-27._ The full plan (all phases, dependencies, open
decisions) lives in **`roadmap.md`** — this file is just the "now".

## Last shipped

**#3 — Configure-clangd + TS/esbuild foundation** (v0.1.0, commit `4651eb6`).
Before it: #2 C support / clangd (0.0.2), #1 WLA-DX highlighting (0.0.1).

## Current focus

**P0 — Build + run/preview (C5):** `make` build task + cc65816 problem matcher,
`Run in luna` (native window), inline `--screenshot` preview. First real luna
contact. No blocking decision.

## Foundations in place

TS + esbuild build (`npm run compile`/`watch`/`package`), Node test harness
(`npm test`), `vsce` packaging, WLA grammar generator. Single extension at root;
promote to npm-workspaces when a 2nd package lands.

## Watch items

- Confirm `run_until_pc` / `run_until_mem_write|read` exist in the **pinned**
  luna binary (they're in the source) before relying on them for the debugger.
- Open decisions gating later phases: see `roadmap.md` (Q1 DAP-native, Q4
  tiles wrap-vs-build, Q5 debugger-vs-assets order).
