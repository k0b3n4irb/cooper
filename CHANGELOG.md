# Changelog

All notable changes to Cooper are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0] — 2026-06-26

### Added

- **Component #3: `Cooper: Configure clangd` command** — generates the `.clangd`
  for the current OpenSNES project automatically:
  - SDK-path detection: `cooper.opensnesPath` setting → project Makefile's
    `OPENSNES` line → upward search for `lib/include/snes.h` → folder picker.
  - new setting `cooper.opensnesPath` (machine-overridable).
- **TypeScript + esbuild foundation** (first runtime code): `src/`, `tsconfig.json`,
  `esbuild.js`, build/watch/package scripts. The pure config/detection logic
  lives in `src/clangdConfig.ts` (no `vscode` import) and is unit-tested under
  Node (`test/run.js`).

### Verified

- `tsc --noEmit` + esbuild bundle clean; packages with vsce (`cooper-0.1.0`).
- 10/10 node assertions on the pure module, including a closing-the-loop check:
  `clang` parses `hello_world` using the flags the generator actually emits.

## [0.0.2] — 2026-06-26

### Added

- **Component #2: C language support (clangd).** Cooper becomes an extension pack
  that installs the official `llvm-vs-code-extensions.vscode-clangd` extension,
  and provides the OpenSNES clangd configuration:
  - `.clangd` recipe mirroring the SDK's own `clang -fsyntax-only` lint flags
    (`-I lib/include -I . -std=gnu11` + warning suppressions), documented in
    `docs/clangd.md`.
  - Honest `int`=2 caveat: clangd's host target reports `int` as 4 bytes; the
    `cc65816` build is the authority. Fixed-width types (`u8`/`u16`/…) are safe.
  - Verified: these flags parse the entire example corpus (56/56 `main.c`) clean.

## [0.0.1] — 2026-06-26

### Added

- **Component #1: WLA-DX 65816 assembly language support.** Syntax highlighting
  for `.asm`/`.inc` files in the WLA-DX dialect used by OpenSNES:
  - WDC 65816 instruction set (92 mnemonics),
  - 200 WLA-DX directives (generated from the assembler's own parser), case-insensitive,
  - `$hex`/`%binary`/decimal literals, `;` comments, `"`/`'` strings, column-0
    labels, indexed registers.
  - Language configuration (line comment, brackets, auto-closing pairs).
- Project foundation: repo, MIT license, architecture docs under `docs/`.
