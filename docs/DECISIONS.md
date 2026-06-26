# Cooper — Decisions log

Dated, append-only record of stack/architecture decisions, each with the
rationale and the docs that grounded it. Newest last.

---

## 2026-06-26 — Foundation & Component #1 (WLA-DX highlighting)

### D-001 — Form: VS Code extension (not a custom editor)
- **Decision:** Cooper is a VS Code extension (eventually an extension pack).
- **Why:** don't rebuild Monaco/LSP/DAP. Concentrate effort on the SNES-specific
  surface. A standalone (VSCodium + preinstalled extensions) is a *distribution*
  option for later, not a separate architecture.
- **Source:** VS Code Extension API (Language Extensions, Bundling, Publishing),
  verified current 2026-06-26.

### D-002 — Stack: TypeScript + esbuild (deferred until first code component)
- **Decision:** future code components use TypeScript bundled with **esbuild**
  (the officially recommended bundler). Type-check via `tsc --noEmit`.
- **Component #1 needs none of it:** a syntax-highlighting extension is **purely
  declarative** (manifest + TextMate grammar + language config) — no `main`, no
  activation code, no bundler. So #1 ships with zero build tooling; TS/esbuild
  land with the first component that has runtime code (build tasks / DAP).
- **Source:** `code.visualstudio.com/api/working-with-extensions/bundling-extension`
  (esbuild recommended), `.../language-extensions/syntax-highlight-guide`.

### D-003 — Repo layout: single extension now, monorepo later
- **Decision:** single extension at repo root for now. Promote to npm-workspaces
  monorepo (`packages/`) when the second package appears (DAP adapter, MCP
  server, webviews). Migration cost is low; starting monorepo now is premature.

### D-004 — `engines.vscode`: `^1.75.0`
- **Decision:** wide floor for reach (current VS Code is 1.126, 2026-06-24). A
  grammar-only extension needs no modern API, so a low floor maximizes
  compatibility. Will raise per-component when newer APIs are required.

### D-005 — Packaging: `@vscode/vsce` (+ OpenVSX later)
- **Decision:** package `.vsix` with `@vscode/vsce` (v3.9.2, needs Node ≥22).
  Publish to OpenVSX (`ovsx`) too for VSCodium/Cursor reach, when we publish.

### D-006 — WLA-DX grammar: tailored, generated from the assembler's parser
- **Decision:** write a tailored TextMate grammar rather than reuse a generic
  65816 grammar (e.g. `language-65asm`, `joshneta.65816-assembly`). The WLA-DX
  *dialect* (its 200 directives) is the specific part that generic grammars miss.
- **Source of truth:** the directive set is extracted from
  `opensnes/compiler/wla-dx/phase_1.c` (the assembler's own directive table +
  the conditional-assembly family), so it tracks the real dialect. WLA is
  **case-insensitive** (confirmed: real corpus mixes `.ACCU`/`.db`/`.ENDS`), so
  the grammar matches directives case-insensitively.
- **Scopes:** standard TextMate scopes (`keyword.control.directive`,
  `support.function.mnemonic`, `constant.numeric.*`, `comment.line.semicolon`,
  `entity.name.function.label`, `variable.language.register`) for theme
  compatibility.
- **Provenance note:** the grammar JSON is committed as a static artifact
  (grammars are static data). It was generated once; if the WLA dialect changes,
  regenerate from `phase_1.c`.

---

## 2026-06-26 — Component #2 (C language support / clangd)

### D-007 — clangd is off-the-shelf, bundled via `extensionPack`
- **Decision:** don't reimplement an LSP client. Cooper is an **extension pack**
  that lists `llvm-vs-code-extensions.vscode-clangd` in `extensionPack`, so
  installing Cooper installs clangd support. (`extensionPack`, not
  `extensionDependencies`: Cooper doesn't call clangd's API, and the user may
  remove it — it's a curated bundle, not a hard dependency.)
- **Source:** clangd.llvm.org/installation (official VS Code extension id),
  verified 2026-06-26.

### D-008 — clangd config mirrors the SDK's own clang lint
- **Decision:** the OpenSNES `.clangd` adds `-I <sdk>/lib/include -I . -std=gnu11`
  plus the SDK's warning suppressions (`-Wno-pointer-to-int-cast`,
  `-Wno-int-to-pointer-cast`, `-Wno-unused-parameter`). This **mirrors
  `make/common.mk`'s `CLANG_LINT_FLAGS` + `-I lib/include`** so clangd sees what
  the build's sibling clang check sees.
- **No `-D__OPENSNES__`:** deliberately omitted, exactly as the SDK's host-clang
  lint omits it. On a 64-bit host `long` is 8 bytes, so defining `__OPENSNES__`
  (which routes `s32` through `long`) would make `sizeof(s32)` wrong. The host
  `#else` branch of `lib/include/snes/types.h` keeps fixed-width sizes correct.
- **`int`=2 caveat is documented, not hidden** (`docs/clangd.md`): clangd's host
  target reports `int`/`unsigned int` as 4 bytes; on target they're 2.
  **Authority = the `cc65816` build.** Fixed-width types (`u8`/`u16`/…) are safe
  in clangd. (This is the D11 caveat from the architecture dossier, made concrete.)
- **Source of truth for flags:** `opensnes/make/common.mk` (`CLANG_LINT_FLAGS`),
  `opensnes/bin/cc65816` (`-D__OPENSNES__=1` for the *real* preprocess only).
- **Verification:** `clang -fsyntax-only` with these flags parses **56/56**
  example `main.c` clean (clang 22 = clangd's frontend), so the config is proven
  across the whole corpus, not one file.

### D-009 — auto-generator deferred to the next slice (first TS code)
- **Decision:** this slice ships the **declarative** path (extension pack + a
  documented, verified `.clangd` recipe). A `Cooper: Configure clangd` command
  that detects the SDK path and writes the `.clangd` automatically is the next
  component — it is the first piece of Cooper that needs runtime code, and will
  stand up the TS + esbuild scaffold (per D-002). Kept separate to keep each
  slice small and fully verifiable ("doucement").

---

### Known limitations (Component #1)
- Standalone accumulator register `A` (e.g. `asl a`) is not scoped, to avoid
  false-positives on identifiers named `a`. Indexed `,x`/`,y`/`,s`/`,b` are.
- No semantic highlighting (TextMate only) — fine for v1; semantic tokens would
  need an LSP, a later component.
