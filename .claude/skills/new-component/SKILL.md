---
name: new-component
description: Ship a new Cooper component (a VS Code feature for the OpenSNES IDE) with the project's research → ground → decide → verify → commit discipline. Use when adding any capability to Cooper.
argument-hint: [component name or capability]
---

# Ship a new Cooper component

Follow these steps in order. Do not skip verification. See
`.claude/rules/workflow.md` for the rationale.

## 1. Research current docs (don't trust memory)

Fetch the up-to-date official docs for every technology the slice touches (VS
Code Extension API, clangd, DAP, esbuild, language servers…). Use the
`doc-researcher` agent (or `/ground-in-docs`). Record versions and dates. Tech
moves — assume your memory is stale until confirmed.

## 2. Ground in the real source

Read the actual OpenSNES / luna code for the facts the slice depends on:
sentinel files, compiler flags, parser tables, ABI offsets, MCP catalogue.
Use the `sdk-source-cartographer` agent. The SDK is at `../opensnes`, luna at
`../luna`. Never infer a flag or path — verify it. (Example: the WLA directive
set comes from `phase_1.c`; the clangd flags from `make/common.mk`.)

## 3. Decide at ≥95% and record it

Add an entry to `docs/DECISIONS.md`: the decision, the rationale, the alternative
rejected, the source that grounds it. Below 95% means a missing doc or source
read — go back to step 1 or 2.

## 4. Implement declarative-first

Pick the cheapest correct shape. A grammar/config needs no runtime code (pure
manifest + data). Introduce TS only for genuine runtime logic, and keep pure
logic out of `vscode` imports so it stays Node-testable
(`.claude/rules/extension-dev.md`).

## 5. Verify before commit (mandatory)

- `npm run compile` (tsc --noEmit + esbuild) clean.
- A **real** test: against the OpenSNES example corpus or a real example, not a
  toy. Add it to `test/` when there's reusable logic. Close the loop where
  possible (e.g. run the emitted output through `clang`/`luna`).
- `npx @vscode/vsce package --no-dependencies` clean.

## 6. Commit

Update `CHANGELOG.md`, `README.md` status row, and `.claude/notes/status.md`.
Then (per `.claude/rules/commits.md`): `touch
/tmp/opensnes_tests_passed_$(date +%Y-%m-%d)` in a separate call, then a
Conventional Commit, **no Co-Authored-By trailer**.
