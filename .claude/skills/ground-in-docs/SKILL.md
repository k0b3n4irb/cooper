---
name: ground-in-docs
description: Verify the current, up-to-date official documentation for a technology before deciding (VS Code Extension API, clangd, DAP, esbuild, Claude Code skills/agents, etc). Use whenever a decision depends on how an external tool/API works today.
argument-hint: [technology or API to verify]
---

# Ground a decision in current docs

The project rule: **never trust memory for how an external tool works.** APIs and
recommendations change. Confirm against the live official docs.

## Procedure

1. **Delegate to the `doc-researcher` agent** for the technology in question.
   Ask for: the current recommended approach, exact config/manifest shape, the
   relevant version numbers, and any 2024–2026 changes. Have it quote verbatim
   and cite URLs.
2. **Prefer official sources**: `code.visualstudio.com/api`,
   `clangd.llvm.org`, `microsoft.github.io/debug-adapter-protocol`,
   `code.claude.com/docs`, the tool's own repo/README.
3. **Capture the facts that pin the decision** — versions (e.g. "VS Code 1.126",
   "@vscode/vsce 3.9.2, Node ≥22", "TS 6 deprecates moduleResolution: node"),
   exact field names, exact flags.
4. **Record what you found** in `docs/DECISIONS.md` alongside the decision it
   supports, with the source URL and the date verified.

## Why

Real bugs avoided by doing this: TS 6 rejecting `moduleResolution: node`;
`onCommand` activation being auto-generated since 1.74 (so `activationEvents` can
be empty); esbuild being the official bundler over webpack. A from-memory guess
would have shipped each wrong.
