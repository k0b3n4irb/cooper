---
name: regen-wla-grammar
description: Regenerate the WLA-DX 65816 TextMate grammar from the assembler's parser and verify it against the OpenSNES ASM corpus. Use when the WLA dialect changes or when adding directive/mnemonic coverage.
---

# Regenerate & verify the WLA-DX grammar

The grammar (`syntaxes/wla65816.tmLanguage.json`) is a **generated static
artifact**. Its source of truth is the WLA-DX assembler's own parser, not a
generic 65816 list (decision D-006).

## Regenerate

```bash
OPENSNES=../opensnes python3 scripts/gen-wla-grammar.py
```

This extracts the directive set from `compiler/wla-dx/phase_1.c` (directive-table
comparisons + the conditional-assembly family), adds a `.END*` catch-all for
dynamically-built closers, and writes the grammar (case-insensitive). It should
report ~192 directives + 92 mnemonics.

## Verify against the real corpus (do not skip)

Tokenize the whole OpenSNES ASM corpus with the **actual VS Code TextMate
engine** and assert no directive/mnemonic is left unscoped:

```bash
npm i -D vscode-textmate vscode-oniguruma   # if not already present
node test/grammar.test.js                   # if present; else use the snippet below
```

The check loads `syntaxes/wla65816.tmLanguage.json` via `vscode-textmate` +
`vscode-oniguruma`, tokenizes every `*.asm`/`*.inc` under
`../opensnes/lib/source` and `../opensnes/templates`, and **fails if any token
matching `^\.[A-Za-z]` (a directive) lands in the bare `source.wla65816` scope**
(= a missed directive). Targeted assertions also check that `.SECTION`/`.ACCU`/
`.ifdef` → `keyword.control.directive`, mnemonics → `support.function.mnemonic`
(incl. `.b/.w/.l` suffixes), `$hex` → `constant.numeric.hex`, `;` → `comment`,
labels → `entity.name.function.label`.

Last known-good: 56-file corpus, 0 directive-looking tokens unscoped.

## After verifying

If the directive/mnemonic counts changed, note it in `CHANGELOG.md` and commit
the regenerated grammar with a `feat(lang):`/`fix(lang):` message (no
Co-Authored-By; `touch` the test marker first — see `.claude/rules/commits.md`).
