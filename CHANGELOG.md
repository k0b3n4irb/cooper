# Changelog

All notable changes to Cooper are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); the project uses
[Semantic Versioning](https://semver.org/).

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
