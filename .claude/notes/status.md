# Cooper — status

_Last updated 2026-06-27._

## Shipped

| Component | Version | What |
|---|---|---|
| #1 WLA-DX highlighting | 0.0.1 | TextMate grammar (92 mnemonics + size suffixes, 200 directives from the WLA parser, `.END*` catch-all). Verified on 56-file ASM corpus, 0 unscoped directives. |
| #2 C support (clangd) | 0.0.2 | Extension pack bundling `vscode-clangd`; `.clangd` recipe mirroring the SDK lint; `int`=2 caveat documented. Verified: 56/56 `main.c` parse clean. |
| #3 Configure-clangd + TS foundation | 0.1.0 | `Cooper: Configure clangd` command (SDK detection: setting → Makefile → upward search → picker); TypeScript + esbuild scaffold; pure logic in `src/clangdConfig.ts`, Node-tested (10/10). |

## Next

- **C5 — Build + run/preview** (next up): `make` build task + cc65816 problem
  matcher (errors → Problems panel); `luna run game.sfc` (native window) +
  `luna run --steps N --screenshot` inline preview. First real luna contact.
- Then **C4 — Debugger** (the jewel): symbol/ASM-level on luna's `run_until_pc`
  first; then the compiler debug-info chantier (`docs/03`) for source-level.

## Foundations in place

- TS + esbuild build (`npm run compile`/`watch`/`package`), Node test harness
  (`npm test`), `vsce` packaging. Repo is a single extension at root; promote to
  npm-workspaces when a 2nd package (DAP adapter / MCP server / webviews) lands.

## Open questions (carried from `docs/01` §15)

- **Q1** DAP-native in luna vs TS adapter in the IDE (leaning: prototype TS →
  migrate to DAP-native, since the author owns luna).
- **Q4** asset editor #3: wrap `SNESTilesKitten` vs a webview of our own.
- **Q5** debugger-first vs assets-first phasing.
- **Q6** debug-info form — **resolved** in `docs/03`: extend the WLA `.sym`.
