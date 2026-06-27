# Cooper — current snapshot

_Last updated 2026-06-27._ The full plan (all phases, dependencies, open
decisions) lives in **`roadmap.md`** — this file is just the "now".

## Last shipped

**P2.1 — ASM/symbol-level debugger (C4, the jewel — MVP)** (v0.3.0). In-process
DAP adapter over luna: F5 a `.sfc`, symbol (function) breakpoints via `.sym` +
`run_until_pc`, continue, step, Registers scope, 1-frame symbolized stack.
Verified **headlessly end-to-end** against the real luna 1.1.0 binary (56 tests).
- P2.1a foundation: `src/sym.ts` (`.sym` parser) + `src/lunaMcp.ts` (stdio MCP
  client, zero deps). P2.1b: `src/lunaDebug.ts` (`LunaDebugSession`,
  `@vscode/debugadapter`) + `contributes.debuggers type:luna`. D-016…D-019.
- Before it: P0 build + preview (0.2.0), #3 Configure-clangd + TS (0.1.0), #2
  clangd (0.0.2), #1 WLA-DX highlighting (0.0.1). Full Done table in `roadmap.md`.

## Current focus

**Next: P2.2 — debugger viewers + memory/data breakpoints**, or interleave **P1
(helper polish, C3)**. Candidate P2.2 work:
- `readMemoryRequest` → `peek_memory`/`peek_vram`/`peek_aram` (named WRAM/VRAM/ARAM
  memory view). Note: no MCP `peek_cgram`/`peek_oam` yet (D-016 gap).
- Data breakpoints → `run_until_mem_write|read` (DAP `dataBreakpointInfo` +
  `setDataBreakpoints`). Mem-watch is **bank-exact** (D-016 caveat).
- PPU/VRAM/OAM viewers (webview at a stop) — the "waouh", low risk.
- Better multi-breakpoint continue (current >1-bp path is a chunked scan that may
  overshoot). Source-level (P7) still gated on G0 (`wla -i` + `wlalink -S -A`).

## Foundations in place

TS + esbuild build (`npm run compile`/`watch`/`package`), Node test harness
(`npm test`), `vsce` packaging, WLA grammar generator. Single extension at root;
promote to npm-workspaces when a 2nd package lands.

## Watch items

- luna MCP catalogue gaps surfaced by P2.1 (D-016): no `peek_cgram`/`peek_oam`
  tool (blocks bulk CGRAM/OAM views); no multi-breakpoint "continue" or async
  stop-event; mem-watch is **bank-exact** (watch `$80:..` FastROM, `$00:..` LoROM).
- Source-level debug (P7) gated on G0 build flags (`wla -i` + `wlalink -S -A`).
- Open decisions: `roadmap.md` (Q4 tiles wrap-vs-build, Q5 debugger-vs-assets).
