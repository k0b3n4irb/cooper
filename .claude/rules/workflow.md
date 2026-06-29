# Workflow — research → ground → decide → implement → verify → document

The discipline that produced every Cooper component. Apply it to each new slice.
The `/new-component` skill is the invokable checklist; this is the rationale.

## The six steps (in order)

1. **Research current docs — never trust memory.**
   Before choosing any technology or API, fetch the *current* official docs
   (VS Code Extension API, clangd, DAP, esbuild, the Claude Code skill/agent
   format…). Tech moves; what you "remember" is often stale. Use the
   `doc-researcher` agent or `/ground-in-docs`. Quote versions and dates.

2. **Ground in the real source.**
   Read the actual OpenSNES / luna code for the facts a decision depends on:
   sentinel files, compiler flags, parser tables, ABI offsets. Do not infer
   them. Use the `sdk-source-cartographer` agent. Example: the WLA directive
   set is extracted from `phase_1.c`, not from a generic 65816 list.

3. **Decide at ≥95% confidence, and record it.**
   Write the decision in `docs/DECISIONS.md` with rationale, the alternative
   rejected, and the source that grounds it. If you are below 95%, you are
   missing a doc or a source read — go back to 1 or 2.

4. **Implement declarative-first.**
   The cheapest correct slice wins. A syntax grammar needs no runtime code; a
   config recipe may need none. Only introduce TS+esbuild when a feature has
   genuine runtime logic. Keep pure logic out of `vscode` imports so it stays
   testable (see `extension-dev.md`).

5. **Verify before commit — not optional.**
   Build (`tsc --noEmit` + esbuild), run a *real* test (against the OpenSNES
   corpus or a real example, not a toy), and `vsce package`. Then commit.

6. **Document it — for the user, and for yourself.**
   A feature that ships undocumented doesn't really exist. Update the user-facing
   guide (`docs/USER_GUIDE.md`) — what it does, how to use it, the gotchas — and
   add the step to the in-editor walkthrough (`contributes.walkthroughs`) when it's
   user-visible. Prefer **didactic**: a screenshot or a short tutorial beats a
   paragraph. This doubles as the honest status of the project: if you can't write
   a clear "here's how you use it", the slice isn't done. (User asked for this,
   2026-06-29: pair development with documentation.)

## Why verification is mandatory

Verification has caught a real, shipping-blocking bug in **every** component:

- #1 (WLA grammar): the corpus sweep found `.l`/`.w`/`.b` size suffixes and the
  dynamically-built `.END*` closers were unscoped — fixed before commit.
- #2 (clangd): grounding in `make/common.mk` revealed the SDK already runs a
  clang lint, and `types.h` proved `-D__OPENSNES__` must be omitted on the host.
- #3 (configure-clangd): the Node test failed instantly on a wrong sentinel
  (`snes/snes.h` vs `snes.h`) and on TS 6's deprecation of `moduleResolution:
  node` — both fixed before commit.

"It compiled" is not verification. **Run the thing against reality.**

## Pace

Slowly, one component at a time ("doucement"). Each slice should be small enough
to verify end-to-end and commit as one coherent Conventional Commit.
