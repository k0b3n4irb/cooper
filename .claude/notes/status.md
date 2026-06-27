# Cooper — current snapshot

_Last updated 2026-06-27._ The full plan (all phases, dependencies, open
decisions) lives in **`roadmap.md`** — this file is just the "now".

## Last shipped

**P2.2a — debugger memory view + evaluate** (v0.4.0). `readMemoryRequest` (CPU-bus
hex viewer via `peek_memory`) + `evaluateRequest` (watch a `.sym` symbol or
literal address → first byte + memoryReference); registers carry memoryReferences.
Verified end-to-end vs real luna (68 tests). D-020.

Before it: **P2.1** ASM/symbol debugger MVP (0.3.0) — DAP adapter (`lunaDebug.ts`,
`@vscode/debugadapter`) over luna MCP + `.sym`: symbol breakpoints (`run_until_pc`),
continue/step, Registers scope, symbolized stack; foundation `sym.ts` + zero-dep
`lunaMcp.ts`. D-016…D-019. Earlier: P0 preview (0.2.0), #3/#2/#1.

## Current focus

**Next: P2.2b** (more debugger surface), or interleave **P1 (helper polish, C3)**:
- **Data breakpoints** → `run_until_mem_write|read` (DAP `dataBreakpointInfo` +
  `setDataBreakpoints`). Mem-watch is **bank-exact** (D-016 caveat).
- **VRAM/ARAM memory** via `peek_vram`/`peek_aram` (distinct ref scheme; D-020).
- **PPU/VRAM/OAM viewers** (webview at a stop) — the "waouh", low risk.
- Better multi-breakpoint continue (current >1-bp path is a chunked scan that may
  overshoot). Source-level (P7) still gated on G0 (`wla -i` + `wlalink -S -A`).
- Gap: no MCP `peek_cgram`/`peek_oam` in the pinned binary (D-016) → luna RFE.

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
