# Cooper — current snapshot

_Last updated 2026-06-27._ The full plan (all phases, dependencies, open
decisions) lives in **`roadmap.md`** — this file is just the "now".

## Last shipped

**P2.2b — data (memory-watch) breakpoints** (v0.5.0). `dataBreakpointInfo` +
`setDataBreakpoints` → `run_until_mem_write|read`: stop when a `.sym` symbol or
address is written/read. Verified vs real luna ($2100 write → PC 0x836B in
InitHardware). 74 tests. D-021.

Before it: **P2.2a** memory view + evaluate (0.4.0, D-020); **P2.1** ASM/symbol
debugger MVP (0.3.0, `lunaDebug.ts`/`sym.ts`/`lunaMcp.ts`, D-016…D-019); P0
preview (0.2.0); #3/#2/#1.

## Current focus

**The debugger (C4) is now a real tool**: symbol + data breakpoints, step,
registers, memory view, symbolized stack — all verified headlessly vs real luna.
Next options:
- **P2.2c — VRAM/ARAM memory** (`peek_vram`/`peek_aram`, distinct ref scheme;
  D-020) and **PPU/VRAM/OAM viewers** (webview at a stop) — the "waouh", but UI
  (not headless-testable).
- **P1 — helper polish (C3)** (snippets, Doxygen hover, `compile_commands.json`).
- Deferred: better multi-breakpoint continue; source-level (P7) gated on G0
  (`wla -i` + `wlalink -S -A`). Gap: no MCP `peek_cgram`/`peek_oam` (D-016) → RFE.

## Foundations in place

TS + esbuild build (`npm run compile`/`watch`/`package`), `vsce` packaging, WLA
grammar generator. Single extension at root; promote to npm-workspaces when a 2nd
package lands. **Two test tiers** (D-022): `npm test` = fast Node tier (pure
modules + the DAP session driven directly, no display); `npm run test:integration`
= real Extension Development Host via `@vscode/test-electron` (verifies the
`vscode` glue + debug adapter; downloads VS Code into `.vscode-test/`; `xvfb-run
-a` on headless CI).

## Watch items

- luna MCP catalogue gaps surfaced by P2.1 (D-016): no `peek_cgram`/`peek_oam`
  tool (blocks bulk CGRAM/OAM views); no multi-breakpoint "continue" or async
  stop-event; mem-watch is **bank-exact** (watch `$80:..` FastROM, `$00:..` LoROM).
- Source-level debug (P7) gated on G0 build flags (`wla -i` + `wlalink -S -A`).
- Open decisions: `roadmap.md` (Q4 tiles wrap-vs-build, Q5 debugger-vs-assets).
