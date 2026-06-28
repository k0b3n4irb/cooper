# Cooper — current snapshot

_Last updated 2026-06-27._ The full plan (all phases, dependencies, open
decisions) lives in **`roadmap.md`** — this file is just the "now".

## Last shipped

**P2.2c — debugger PPU viewers** (palette 0.6.0 · OAM 0.7.0 · VRAM tiles 0.8.0).
Three webviews of the live PPU at a debug stop: **CGRAM palette** (16×16 swatches),
**OAM** (128-sprite table), **VRAM tiles** (512 4bpp tiles → PNG). Decoded in pure
`src/ppu.ts`/`src/tiles.ts` (incl. a zero-dep PNG encoder); fed by custom DAP
requests `cooperPpu`/`cooperVram`. Verified both tiers + visually (VRAM PNG shows
real font glyphs). 101 Node + 3 integration tests. D-023…D-025.

Before it: **P2.2b** data breakpoints (0.5.0); **P2.2a** memory view (0.4.0);
**P2.1** ASM/symbol debugger MVP (0.3.0); test harness (D-022); P0 (0.2.0); #3/#2/#1.

## Current focus

**The debugger (C4) is a real tool**: symbol + data breakpoints, step, registers,
memory view, symbolized stack, and live palette / OAM / VRAM-tile viewers. Options:
- **Polish the viewers:** bpp/offset/sub-palette selectors for VRAM (QuickPick);
  VRAM/ARAM in the hex memory view; render actual sprite pixels in the OAM view
  (combine OAM + VRAM + palette).
- **P1 — helper polish (C3)** (snippets, Doxygen hover, `compile_commands.json`) —
  a change of register.
- Deferred: better multi-breakpoint continue; source-level (P7) gated on G0
  (`wla -i` + `wlalink -S -A`).

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
