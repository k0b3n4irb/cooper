# CLAUDE.md — Cooper

Guidance for Claude Code working in this repository. These instructions are
load-bearing; follow them exactly.

## What Cooper is

**Cooper is the unified IDE for making SNES games on the OpenSNES SDK + the luna
emulator.** It is a **VS Code extension** (an extension pack, growing). Mission:
**make SNES game developers happy.**

The decisive fact: **one author owns the whole vertical** — the SDK (OpenSNES),
the compiler (`cc65816`: cproc → QBE → wla), *and* the emulator (luna). No other
SNES homebrew stack has this. So Cooper is not an integration of third-party
tools — it is **co-design** across tools the author controls.

**The "ring" is a contract, not a fourth app.** The thing that binds the stack:

1. **rich debug-info emitted by the compiler** (line↔PC, frame layouts, types —
   an extended WLA `.sym`), and
2. **luna as the debug/run backend** (ideally DAP-native).

Everything else — the extension, the asset editors, the AI helper — are **thin
clients of that contract**. Full design lives in `docs/`:

- `docs/01-architecture.md` — the architecture (the ring/contract, capabilities).
- `docs/02-debugger-dap-luna.md` — the DAP ↔ luna debugger.
- `docs/03-debug-info-format.md` — the debug-info format (extend WLA `.sym`).
- `docs/clangd.md` — C support config + the `int`=2 caveat.
- `docs/DECISIONS.md` — dated decision log (D-001…). **Read before re-deciding.**

## Capabilities & status

| # | Capability | Status |
|---|---|---|
| C1b | WLA-DX 65816 syntax highlighting | ✅ shipped |
| C1/C2/C3 | C support via clangd (+ `Configure clangd` command) | ✅ shipped |
| C5 | Build + run/preview (tasks + luna) | next |
| C4 | Debugger (DAP ↔ luna) | planned — the jewel |
| C6 | Asset editors (palette → tiles → map) | planned |
| C7 | AI SDK-aware (context → MCP → luna verify loop) | planned |

The value over "VS Code + a Makefile" is **C4 + C6 + C7 + scaffolding**. The rest
is assembly of off-the-shelf parts.

## The working discipline (non-negotiable)

For **every** component, in order — see `.claude/rules/workflow.md` and the
`/new-component` skill:

1. **Research current docs** — verify the up-to-date official docs for any tech
   (VS Code API, clangd, DAP, esbuild…). **Do not trust memory.** Use
   `/ground-in-docs` / the `doc-researcher` agent.
2. **Ground in the real source** — read the actual OpenSNES/luna code for
   sentinels, flags, parser tables. Use the `sdk-source-cartographer` agent.
3. **Decide at ≥95% confidence** — record the decision in `docs/DECISIONS.md`.
4. **Implement declarative-first** — if a feature needs no runtime code (e.g. a
   grammar), ship it as pure manifest + data.
5. **Verify before commit** — build (`tsc` + esbuild), run a real/corpus test,
   `vsce package`. Verification has caught a real bug in every component so far;
   it is not optional.
6. **Document it** — update `docs/USER_GUIDE.md` (didactic: screenshots/tutorials)
   and the in-editor walkthrough when user-visible. A feature that ships
   undocumented doesn't exist; the guide is also the project's honest status.

## Stack & conventions

- **VS Code extension, TypeScript + esbuild** (the official bundler).
- **`engines.vscode` `^1.75.0`** (wide reach; `onCommand` auto-activates since
  1.74 → `activationEvents: []`). **`@types/vscode` pinned `~1.75`** (≤ engines).
- **tsconfig**: `module`/`moduleResolution` = `Node16` (`node` is deprecated in
  TS 6), `types: ["node"]`, `strict`, `noEmit` (esbuild emits the bundle).
- **Testable split**: pure logic lives in `src/*.ts` with **no `vscode` import**,
  unit-tested under Node (`test/run.js`). `src/extension.ts` is thin glue.
- **Packaging**: `@vscode/vsce` (Node ≥ 22) → `.vsix`; OpenVSX later.
- **Repo layout**: single extension at root now; promote to npm-workspaces
  monorepo when a 2nd package (DAP adapter, MCP server, webviews) appears.

Build commands: `npm run compile` · `npm run watch` · `npm test` ·
`npm run package` · `npx @vscode/vsce package --no-dependencies`.

## Architecture discipline (the garde-fou)

Solo "all-in-one" dies by breadth. The rule (`.claude/rules/architecture.md`):
**anything that is not the contract, or a thin client of the contract, is debt.**
Corollaries: single engine (luna), orchestrated never embedded; **sources, not
binaries** (editors edit `.c`/`.png`/`.pal`/`.map`; conversion stays in the
build; hardware truth comes from luna); **off-the-shelf everywhere except** C4
(debugger), C6 (asset editors), C7 (AI).

## Facts grounded from the SDK — do not re-derive

- **SDK root sentinel = `lib/include/snes.h`** (the umbrella header), NOT
  `lib/include/snes/snes.h` (the `snes/` subdir holds only sub-headers).
- **clangd config mirrors the SDK's own clang lint** (`make/common.mk`
  `CLANG_LINT_FLAGS` + `-I lib/include`), **without `-D__OPENSNES__`** (on a
  64-bit host `long` is 8 bytes → defining it mis-sizes `s32`). The **`int`=2**
  caveat: clangd's host target says `int`=4; the **`cc65816` build is the
  authority**. Fixed-width types (`u8`/`u16`/…) are safe. See `docs/clangd.md`.
- **WLA grammar is generated** from the assembler's own parser
  (`opensnes/compiler/wla-dx/phase_1.c`) + a `.END*` catch-all for
  dynamically-built closers; WLA is **case-insensitive**. Regenerate via
  `/regen-wla-grammar` (`scripts/gen-wla-grammar.py`).
- **luna**: `luna mcp` is a persistent stdio MCP server holding **live emulator
  state across calls**. **Ground its catalogue with a live JSON-RPC `tools/list`,
  NOT `luna mcp --help`** — the pinned v1.1.0 binary's `--help` is stale (lists 8
  read-only tools); the **live catalogue is 17 tools** (verified 2026-06-27):
  reads (`peek_memory`, `peek_vram`, `peek_aram`, `search_memory`, `state`,
  `screenshot`, `drain_audio`), writes (`poke_memory`, `set_cpu_register`,
  `set_joypad`), run/breakpoint (`step`, `step_until_frame`, **`run_until_pc`**,
  **`run_until_mem_write`**, **`run_until_mem_read`**), lifecycle (`load_rom`,
  `reset`). The runtime **breakpoint primitives ARE in the pinned binary** — P2
  (symbol/ASM debugger) is buildable against it today, no luna RFE. luna source
  is v1.3.0; `peek_cgram` exists in `luna-api` but is **not** MCP-registered, and
  there is no `peek_oam`. Mem-watch is **bank-exact, not mirror-folded**. See
  `docs/02-debugger-dap-luna.md` §10.
- All OpenSNES example Makefiles use `OPENSNES := $(shell cd ../../.. && pwd)`.
- The OpenSNES SDK lives at `../opensnes` relative to this repo; luna source at
  `../luna`; the pinned luna binary at `../opensnes/tools/luna-test/bin/luna`.

## Commits

- **[Conventional Commits](https://www.conventionalcommits.org/).** Scopes:
  `lang`, `c`, `build`, `debug`, `assets`, `ai`, `docs`, `claude`, `test`,
  `deps`. Imperative, no trailing period.
- **NEVER add `Co-Authored-By` trailers** (any variant). No AI attribution in
  git history. Ever.
- **git user.email = `k0b3n4irb@gmail.com`** (the GitHub account email).
- **Global pre-commit hook bypass:** OpenSNES installs a *global* git pre-commit
  hook that blocks commits until its test suite ran today. It fires in Cooper
  too, but Cooper has **no relation** to the OpenSNES test suite. For Cooper
  commits this is a legitimate bypass: run `touch
  /tmp/opensnes_tests_passed_$(date +%Y-%m-%d)` in a **separate** Bash call
  **before** `git commit` (it cannot be in the same command as the commit).

## `.claude/` layout

- `.claude/rules/` — normative rules: `workflow.md`, `architecture.md`,
  `extension-dev.md`, `commits.md`. Read them.
- `.claude/notes/` — context: `roadmap.md` (the plan: done + phased remaining),
  `status.md` (the "now"), `project-overview.md`, routing `README.md`.
- `.claude/skills/` — `/new-component`, `/ground-in-docs`, `/regen-wla-grammar`.
- `.claude/agents/` — `doc-researcher`, `sdk-source-cartographer`.
