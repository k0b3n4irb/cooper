# Cooper — project overview

## The one-sentence pitch

Cooper is an all-in-one IDE for making SNES games on the **OpenSNES** SDK and the
**luna** emulator — edit C and WLA-DX assembly, get AI help, debug at source
level, run and preview, and author sprites/maps/palettes — all in one place.

## Why it can exist (the superpower)

SNES homebrew tooling is normally a pile of third-party parts bolted together:
an SDK from one project, an assembler from another, an emulator from a third, a
tile editor from a fourth. **Cooper's author owns the entire vertical** —
the SDK (OpenSNES), the compiler (`cc65816` = cproc → QBE → wla), *and* the
emulator (luna). That means Cooper is not integration; it is **co-design**. The
SDK can emit exactly the debug-info the IDE needs; luna can grow exactly the
control surface the debugger needs; nothing is gated on a third party.

Competitive position: PVSnesLib is an SDK only; Mesen2 is an emulator only (great
debugger, but blind to your C). No one owns the full stack — so no one else can
close the edit→build→see→debug loop with no seams. That seamless loop is the
product.

## The ring = a contract, not a fourth app

The unifying artifact is not another application; it's a **shared contract** the
three projects agree on:

1. **Compiler debug-info** — line↔PC, frame layouts, types, as an extended WLA
   `.sym` (don't invent a new format; WLA already has addr-to-line). See
   `docs/03-debug-info-format.md`.
2. **luna as the run/debug backend** — ideally speaking DAP natively, so *any*
   DAP editor can debug SNES games, not just Cooper.

The VS Code extension, the asset editors, and the AI helper are **thin clients**
of that contract. The value lives in the contract + the backend.

## Capabilities

| # | Capability | Notes |
|---|---|---|
| C1 | Edit C | clangd (off-the-shelf) |
| C1b | Edit WLA-DX 65816 ASM | tailored TextMate grammar |
| C2 | Lint + format C | clang-format + cc65816 problem matcher |
| C3 | Helper (API) | snippets + Doxygen hover + clangd config |
| C4 | **Debugger** | DAP ↔ luna + compiler debug-info — the jewel |
| C5 | Run / preview | `luna run` window + `--screenshot` inline |
| C6 | **Asset editors** | palette → tiles → map, webviews, luna preview |
| C7 | **AI SDK-aware** | context → MCP → agentic verify-in-luna loop |

The real value-add over "VS Code + a Makefile" is **C4 + C6 + C7 + scaffolding**;
the rest is off-the-shelf assembly.

## Mission

Make SNES game developers happy. The honest test for any feature: does it make
the edit→build→see→debug→ship loop faster and less painful for someone making a
game? If not, it's not Cooper's job.

## Where the detail lives

- `docs/01-architecture.md` — full architecture, decisions, phasing, open questions.
- `docs/02-debugger-dap-luna.md` — the debugger design (DAP ↔ luna, two levels).
- `docs/03-debug-info-format.md` — the debug-info chantier (extend WLA `.sym`).
- `docs/clangd.md` — C support config + the `int`=2 caveat.
- `docs/DECISIONS.md` — every locked decision, dated.
