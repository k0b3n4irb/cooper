# Cooper — OpenSNES IDE

> The one ring to bind them: a unified development environment for making SNES
> games on the **OpenSNES** SDK + **luna** emulator.

Cooper is a VS Code extension (pack, eventually) that ties together the whole
OpenSNES vertical — SDK, compiler (`cc65816`: cproc→QBE→wla), and the luna
cycle-accurate emulator — into one workflow: edit, build, run, debug, and
author assets, without seams.

**New to Cooper? → [User Guide](docs/USER_GUIDE.md)** (install, configure, build /
run / debug, troubleshooting, with screenshots).

The design is captured in [`docs/`](docs/):

- [`docs/01-architecture.md`](docs/01-architecture.md) — the full architecture
  (the "ring" = a shared contract, not a fourth app).
- [`docs/02-debugger-dap-luna.md`](docs/02-debugger-dap-luna.md) — the DAP ↔ luna
  debugger design.
- [`docs/03-debug-info-format.md`](docs/03-debug-info-format.md) — the debug-info
  format (extend the WLA `.sym`, don't invent).
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — stack & build decisions, dated.

## Status

Early. Built one component at a time, each grounded in up-to-date docs and
verified before landing.

| Component | Status |
|---|---|
| **#1 — WLA-DX 65816 syntax highlighting** | ✅ shipped |
| **#2 — C language support (clangd)** | ✅ shipped |
| **#3 — Build & preview (make task + luna screenshot)** | ✅ shipped |
| **#4 — Debugger (DAP ↔ luna), ASM/symbol level** | ✅ shipped (MVP) |
| #5 — Asset editors (palette → tiles → map) | planned |
| #6 — AI SDK-aware (context → MCP → luna loop) | planned |

## Component #1 — WLA-DX 65816 assembly highlighting

Syntax highlighting for the WLA-DX assembly dialect used by OpenSNES hand-written
ASM (`.asm`, `.inc`):

- the full **WDC 65816 instruction set** (92 mnemonics),
- **200 WLA-DX directives** (`.SECTION`/`.ENDS`, `.DB`/`.DW`, `.RAMSECTION`,
  `.ACCU`/`.INDEX`, `.IFDEF`/`.ELSE`/`.ENDIF`, …), case-insensitive,
- `$hex` / `%binary` / decimal literals, `;` line comments, `"`/`'` strings,
  column-0 labels, indexed registers.

The directive set is generated from the WLA-DX assembler's own parser
(`compiler/wla-dx/phase_1.c`) — the source of truth — so it tracks the real
dialect, not a generic 65816 grammar.

### Try it locally

Open this folder in VS Code and press <kbd>F5</kbd> (Extension Development Host),
then open any `lib/source/*.asm` from the OpenSNES repo.

## Component #2 — C language support (clangd)

C completion, navigation, and hover for OpenSNES code, via the official **clangd**
extension (bundled — Cooper is an extension pack that installs
`llvm-vs-code-extensions.vscode-clangd` for you). Cooper supplies the OpenSNES
clangd configuration and the honest caveat that clangd's host target reports
`int` as 4 bytes when the SNES target uses 2 — so the **`cc65816` build is the
authority**, clangd is for completion/navigation.

Run **Cooper: Configure clangd** from the Command Palette to generate the
`.clangd` automatically — it finds the SDK via the `cooper.opensnesPath` setting,
the project Makefile's `OPENSNES` line, or by searching parent folders (falling
back to a folder picker).

Setup and the full caveat: [`docs/clangd.md`](docs/clangd.md). The config was
validated against the whole example corpus (56/56 `main.c` parse clean).

> This component introduced Cooper's **TypeScript + esbuild** foundation. Pure
> logic (SDK detection, `.clangd` rendering) lives in `src/clangdConfig.ts` with
> no `vscode` import, unit-tested under Node (`npm test`).

## License

MIT — see [LICENSE](LICENSE).
