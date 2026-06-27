# Architecture discipline

The full design is in `docs/01-architecture.md` (+ `02`, `03`). This rule is the
load-bearing summary and the garde-fou. Consult before adding any capability.

## The ring = a contract, not an app

Cooper binds the OpenSNES vertical (SDK + compiler + luna) through a **shared
contract**, owned by one author:

1. **Debug-info emitted by the compiler** — line↔PC, frame layouts, types, an
   extended WLA `.sym` (see `docs/03-debug-info-format.md`).
2. **luna as the run/debug backend** — ideally DAP-native.

The extension, the asset editors, and the AI helper are **thin clients** of that
contract. The value is in the contract + the backend, not in any one frontend.

## The garde-fou (anti-scope-death)

> **Anything that is not the contract, or a thin client of the contract, is debt.**

Solo "all-in-one" dies by breadth. Every proposed feature must answer: *is this
the contract, or a thin client of it?* If neither, don't build it.

## Standing decisions

- **Single engine: luna.** It does run / preview / test / validation / viewers /
  debug. **Orchestrated as a sibling process, never embedded in a webview.** The
  editor shows snapshots + viewers at a stop, not a real-time video stream.
- **Sources, not binaries.** Editors edit *source* (`.c`/`.asm`/`.png`/`.pal`/
  `.map`); conversion stays in the build (`gfx4snes`/`smconv`/`make`); **hardware
  truth comes from luna** (`assets-dump`/`peek_*`/`screenshot`). Never introduce
  a parallel asset pipeline inside Cooper.
- **Off-the-shelf everywhere except the differentiators.** Don't rebuild Monaco,
  the LSP, or the DAP framework. Build only **C4 (debugger), C6 (asset editors),
  C7 (AI SDK-aware)** — the things config + existing extensions can't provide.
- **Form: VS Code extension** (pack). A standalone (VSCodium + preinstalled
  extensions) is a *distribution* option for later, not a different architecture.

## The debugger (C4) — the jewel

luna already has the runtime (`run_until_pc`, mem watch in source). The missing
piece is the **symbolic layer** + the **compiler debug-info** (line↔PC, frames).
Because the author owns luna and the compiler, this is roadmap, not a third-party
RFE. Path: symbol/ASM-level first → runtime surface + DAP → source-level when the
`.dbg` lands. Details: `docs/02-debugger-dap-luna.md`, `docs/03-debug-info-format.md`.

## The AI helper (C7) — the unique differentiator

Don't build an AI; make any AI OpenSNES-expert: (1) ship SDK context to the
project, (2) an OpenSNES MCP, (3) the agentic loop that **verifies in luna**
(write C → build → run → read framebuffer/state → self-correct). Only the owner
of the full vertical can offer "the AI verified it renders right on cycle-accurate
hardware."
