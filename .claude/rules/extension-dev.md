# VS Code extension conventions

Grounded in the current official docs (verified 2026-06; re-verify if stale).

## Stack

- **TypeScript + esbuild** — the officially recommended bundler. `esbuild.js`
  follows the official template (CJS, `external: ['vscode']`, problem-matcher
  plugin). `tsc --noEmit` type-checks; esbuild emits `dist/extension.js`.
- **tsconfig**: `module` + `moduleResolution` = `Node16` (`node` is **deprecated
  in TS 6** — do not use it). `target` ES2022, `types: ["node"]` (needed for the
  `fs`/`path`/`process` globals), `strict`, `noEmit`.
- **`engines.vscode` `^1.75.0`**, **`@types/vscode` `~1.75`** (must be ≤ engines,
  else `vsce` warns). `onCommand`/`onLanguage` activation is **auto-generated
  since 1.74** → `activationEvents: []`.

## Declarative-first

A feature that needs no runtime code ships as **pure manifest + data** (no
`main`, no activation): e.g. the WLA grammar (`contributes.grammars` +
`contributes.languages` + a `.tmLanguage.json`). Only stand up runtime code when
the feature genuinely needs it.

## Testable split (mandatory once there is runtime code)

- **Pure logic** (detection, parsing, file rendering, any decision) lives in
  `src/*.ts` with **no `import … from 'vscode'`**. This makes it unit-testable
  under plain Node.
- **`src/extension.ts`** is the thin glue: command registration, dialogs,
  settings reads, file writes. It imports the pure modules.
- **Tests** (`test/run.js`) compile the pure module via esbuild and assert
  against **reality** (the real OpenSNES repo, real examples), including
  closing-the-loop checks (e.g. run `clang` with the flags the code emits).
  Rationale: the Extension Development Host can't be driven headlessly here, so
  the valuable logic must be verifiable offline.

## Packaging & versioning

- `@vscode/vsce` (Node ≥ 22): `npx @vscode/vsce package --no-dependencies` →
  `.vsix`. OpenVSX (`ovsx`) later for VSCodium/Cursor reach.
- `.vscodeignore` excludes `src/`, `test/`, `docs/`, `node_modules/`,
  `esbuild.js`, `tsconfig.json`, `**/*.ts`; **`dist/` is included**.
- `repository` field is required (relative links in README break packaging
  without it).
- Pre-1.0: bump the version per shipped slice; keep `CHANGELOG.md` in step.

## Commands & settings

- Command: `contributes.commands` with `command` (`cooper.*`), `title`,
  `category: "Cooper"` (palette shows "Cooper: <title>" — don't repeat "Cooper:"
  in the title).
- Setting: `contributes.configuration` with `cooper.*` keys; use
  `scope: "machine-overridable"` for machine-specific paths (e.g. the SDK path).
