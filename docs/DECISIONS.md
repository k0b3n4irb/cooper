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

### Known limitations (Component #1)
- Standalone accumulator register `A` (e.g. `asl a`) is not scoped, to avoid
  false-positives on identifiers named `a`. Indexed `,x`/`,y`/`,s`/`,b` are.
- No semantic highlighting (TextMate only) — fine for v1; semantic tokens would
  need an LSP, a later component.
