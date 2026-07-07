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

## 2026-06-26 — Component #3 (`Configure clangd` command + TS foundation)

### D-010 — TS + esbuild scaffold landed (per D-002)
- **Decision:** the first runtime-code component stands up TypeScript + esbuild
  exactly as planned in D-002: `src/extension.ts`, `tsconfig.json` (module/
  moduleResolution `Node16` — `node` is deprecated in TS 6), `esbuild.js`
  (the official template), `dist/extension.js` bundle. `engines.vscode ^1.75.0`
  keeps `onCommand` auto-activation (1.74+), so `activationEvents` is empty.

### D-011 — testable split: pure logic vs vscode glue
- **Decision:** all real logic (SDK detection, Makefile parsing, `.clangd`
  rendering) lives in `src/clangdConfig.ts` with **no `vscode` import**, so it is
  unit-testable under plain Node (`test/run.js` compiles it via esbuild, asserts
  against the real SDK, and closes the loop by running `clang` with the *emitted*
  flags). `src/extension.ts` is the thin command/dialog/settings layer.
- **Rationale:** the Extension Development Host can't be driven headlessly here;
  isolating the logic makes the valuable part fully verifiable offline.

### D-012 — SDK detection order
- **Decision:** `cooper.opensnesPath` setting → project `Makefile` `OPENSNES`
  line → upward search for `lib/include/snes.h` → folder picker (persists the
  pick to the workspace setting). The Makefile form handled is the canonical
  `OPENSNES := $(shell cd ../../.. && pwd)` used by all 30 SDK example Makefiles.
- **Sentinel corrected during verification:** the SDK root marker is
  `lib/include/snes.h` (the umbrella header), **not** `lib/include/snes/snes.h`
  (the `snes/` subdir holds only sub-headers). Caught by the node test.

---

---

## 2026-06-27 — Component #4 (P0 — Build + run/preview, C5)

### D-013 — Build via a `TaskProvider`, not a shipped `tasks.json`
- **Decision:** Cooper contributes a `cooper-make` task **programmatically**
  (`contributes.taskDefinitions` + `vscode.tasks.registerTaskProvider`), with a
  `build` task (`make`, default goal = build the ROM) and a `clean` task. The
  build task binds the `$cooper-cc` problem matcher and `TaskGroup.Build`. The
  `Cooper: Build (make)` command runs it via `vscode.tasks.executeTask`.
- **Why not ship a `.vscode/tasks.json`:** `tasks.json` is **user/workspace-owned
  override territory**; an extension contributes tasks via a provider so they
  appear in *Run Task* without writing into the user's repo. Users can still
  override pieces by keying their own `tasks.json` on `type: "cooper-make"`.
- **Source:** VS Code Task Provider guide + `contributes.taskDefinitions`
  (verified 2026-06-27). **Grounded build facts:** `OPENSNES/make/common.mk:191`
  (`.PHONY: all clean`, default goal `all`, **no `run` target**); example
  `Makefile` sets `TARGET := <name>.sfc`; the ROM lands **in the Makefile's own
  dir** (`common.mk:353` link rule), alongside `<name>.sym`.

### D-014 — Problem matcher = `$cooper-cc` (clang/cproc) only for P0
- **Decision:** P0 contributes **one** matcher, `cooper-cc` (owner `cpp`,
  `fileLocation: autoDetect`), pattern `^(.*):(\d+):(\d+):\s+(warning|error):\s+(.*)$`.
  This catches **both** the clang lint *and* the `cc65816` (cproc) driver, which
  share the gcc-style `file:line:col: severity: msg` first line.
- **WLA matcher deferred (grounded, recorded for later):** `wla-65816` errors use
  a *different, column-less* grammar — either `<file>:<line>: MSG` or an
  `ERROR: <msg>` line followed by a separate `  at <file>:<line>`. A loose WLA
  pattern **collides** with clang's line (lazy `.+?` absorbs `:col`, mis-filing
  the diagnostic), so binding both to one task double-reports. WLA errors are rare
  (hand-written `.asm` only) and still show as raw text in the terminal. Deferring
  keeps P0 small and the matcher correct. Re-add as a separate, non-overlapping
  matcher when an asm-build slice needs it.
- **Source:** `doc-researcher` (problem-matcher schema, 2026-06-27);
  `sdk-source-cartographer` (real error lines from `cc65816`/`clang`/`wla-65816`).

### D-015 — Preview = `luna run --screenshot`, headless (no native window)
- **Decision:** `Cooper: Preview frame` runs **`luna run --steps <N>
  --force-display --screenshot <png> <rom>`** and opens the PNG with the built-in
  image viewer (`vscode.commands.executeCommand('vscode.open', uri)`).
- **The roadmap-breaking fact:** the **pinned luna binary (v1.1.0) has NO native
  window** — *every* subcommand is headless (`luna run/state/frames/…`).
  `luna run <rom>` does not open a GUI; it steps N CPU instructions and optionally
  dumps a 256×224 PNG. So the roadmap's "Run in luna (native window)" is
  **impossible on the pinned binary and is deferred** until luna exposes a GUI
  subcommand (author-owned, future phase). This is *aligned* with the architecture
  rule ("snapshots + viewers at a stop, not a real-time video stream").
- **`luna run` over `luna state --until-frame`:** `run` is the purpose-built
  screenshot renderer (lighter; its one job is render→PNG). `state` is the JSON
  snapshot path (traces/asserts/`--until-frame`) — heavier, and frame-exactness is
  not needed for a *preview*. `state` is the right backend later for the debugger,
  not for this. **Alternative rejected:** `state --until-frame`.
- **`--steps 200000` default, grounded empirically:** on the real
  `aim_target.sfc`, `-n 64`/`50000` render a **black** frame (identical fbhash,
  1405-byte PNG); content appears at **200000** and the fbhash **stabilises**
  (`6d80c5a68234dfee`, unchanged 200k→1M). `--force-display` (default on) defeats
  INIDISP forced-blank so a title still waiting on Start isn't black. Both
  surfaced as settings (`cooper.preview.steps`, `cooper.preview.forceDisplay`).
- **luna path:** `cooper.lunaPath` setting → else the pinned binary at
  `<sdk>/tools/luna-test/bin/luna` (grounded; `luna --version` → `luna 1.1.0`,
  aarch64, runs on host). The MCP `run_until_*` breakpoints are **not** in the
  pinned binary's `mcp` catalogue — confirmed, do not rely on them yet.
- **Source:** luna 1.1.0 `run --help` / `state --help` (read live from the pinned
  binary, 2026-06-27); empirical render sweep on `aim_target.sfc`.

---

## 2026-06-27 — P2 de-risk (debugger DAP ↔ luna)

### D-016 — P2 is GO; the pinned luna is a breakpoint backend today; Q1 unblocked
- **Decision:** the **symbol/ASM-level debugger (P2) is buildable against the
  pinned luna 1.1.0 binary today, with no luna source change / no RFE gate.** The
  former blocker ("confirm `run_until_*` exist in the pinned binary") is
  **resolved: they do.**
- **Grounded the right way:** the pinned binary's `luna mcp --help` is **stale**
  (advertises 8 read-only tools); a live JSON-RPC **`tools/list` returns 17 tools**,
  including `run_until_pc`, `run_until_mem_write`, `run_until_mem_read`, `step`
  (1-instruction), `poke_memory`, `set_cpu_register`, plus `state`/`peek_*`. The
  MCP session holds **live emulator state across calls** → a launch → break →
  inspect → continue loop works. This **overturns `docs/02` §9.2** (which trusted
  `--help`). Lesson: query the live MCP server, never `--help`.
- **Proven end-to-end (2 ROMs):** `aim_target.sfc` → `run_until_mem_write($002100)`
  → `{hit:true, pc:0x836B, value:0x8F}`, and `0x836B` resolves to `InitHardware`
  via the `.sym`. `Tetris 2` (FastROM) → `run_until_mem_write($802100)` →
  `{hit:true, pc:0x806064}`. `state` exposes full CPU/PPU/APU/SA1/DMA registers.
- **Symbol layer (`.sym`) is sufficient for P2:** labels↔addresses both ways,
  **C symbols included** (`main`, `gameLoopRun`); no line↔PC yet. Source-level
  (P7) needs **G0** = assemble `wla -i` + link `wlalink -S -A` (emits
  `[addr-to-line mapping v2]`) — localised, not a wall.
- **Q1 (DAP-native vs TS adapter) — resolved as a design choice, not a capability
  gate.** **Recommendation:** prototype a **TS DAP adapter over the pinned MCP**
  (shortest path), migrate to a native `luna dap` later. *Not yet locked — revisit
  when P2.1 starts; this entry only removes the blocker and records the lean.*
- **The 4 ergonomics gaps (non-blocking for the ASM MVP), now RFEs not prereqs:**
  (1) no multi-breakpoint "continue" — one target per `run_until_*` call;
  (2) no async stop-event / interruptible run — `max_steps` is mandatory;
  (3) no bulk CGRAM/OAM read tool (`peek_cgram` exists in luna-api but unexposed;
  no `peek_oam`); (4) `run_until_pc` returns only `hit:bool`. **Caveat:** mem-watch
  is **bank-exact, not mirror-folded** (watch `$80:2100` for FastROM, `$00:2100`
  for LoROM).
- **Source:** live `tools/list` on the pinned binary; luna source
  `luna-api/src/lib.rs` (`run_until_pc:1637`, `mem_write:1673`, `mem_read:1682`),
  `luna-mcp-server/src/lib.rs:276-591` (v1.3.0); `aim_target.sym`;
  `make/common.mk:120/307/355`; `wlalink/write.c:2705`. Full write-up:
  `docs/02-debugger-dap-luna.md` §10.

---

## 2026-06-27 — P2.1 (ASM/symbol-level debugger) — foundation slice (P2.1a)

### D-017 — MCP client: hand-rolled JSON-RPC-over-stdio, zero deps
- **Decision:** talk to `luna mcp` with a ~120-line hand-rolled stdio JSON-RPC 2.0
  client (`src/lunaMcp.ts`, no `vscode` import), **not** the official
  `@modelcontextprotocol/sdk`.
- **Why:** the SDK (`1.29.0`) pulls **~18 hard runtime deps** (`express`, `hono`,
  `jose`, `cors`, `pkce-challenge`, `eventsource`, …) — all HTTP/SSE-transport +
  OAuth machinery we never touch over stdio. Cooper is a deliberately minimal-dep
  extension talking to a **fixed, owned, stdio-only** 17-tool catalogue. Newline-
  delimited JSON-RPC over `child_process` is ~120 lines we fully control. esbuild
  would tree-shake most of the SDK out of the bundle, but it still bloats
  `node_modules` + the audit surface for nothing.
- **The one correctness detail to replicate (the SDK gets it free):** the
  `initialize` (with `protocolVersion: "2024-11-05"`, `clientInfo`) → wait result
  → `notifications/initialized` handshake **before** any `tools/call`. Framing is
  **newline-delimited** JSON (not LSP `Content-Length`) — confirmed live against
  the pinned binary's rmcp server.
- **Alternative rejected:** `@modelcontextprotocol/sdk` — revisit only if we ever
  need HTTP/SSE transport, OAuth, or dynamic tool discovery.
- **Source:** doc-researcher 2026-06-27 (SDK `package.json` deps/exports; MCP
  build-client guide); live stdio probes in D-016.

### D-018 — DAP adapter: `@vscode/debugadapter` + inline implementation (P2.1b)
- **Decision (records the choice; lands in the next slice P2.1b):** implement the
  debug adapter as a `LoggingDebugSession` from **`@vscode/debugadapter` 1.68.0**
  (+ `@vscode/debugprotocol` 1.68.0 types), wired into VS Code via
  **`vscode.DebugAdapterInlineImplementation(new LunaDebugSession())`** from a
  `DebugAdapterDescriptorFactory` — the official mock-debug pattern. In-process,
  no separate adapter binary, no TCP port.
- **Manifest:** `contributes.debuggers` `type: "luna"`, `configurationAttributes.launch`
  `required: ["program"]` (the `.sfc`). **Activation events are NOT auto-generated
  for debuggers** (only `onCommand` is, since 1.74) → declare `onDebugResolve:luna`.
- **Capabilities → luna mapping** (set in `initializeRequest`):
  `supportsConfigurationDoneRequest`; `supportsInstructionBreakpoints` +
  `supportsDisassembleRequest` + `supportsSteppingGranularity` → `run_until_pc` +
  `step{1}`; `supportsDataBreakpoints` → `run_until_mem_write|read`;
  `supportsReadMemoryRequest` → `peek_memory`/`peek_vram`/`peek_aram`;
  `supportsRestartRequest` → `reset` + `load_rom`. Registers shown via a
  `"Registers"` scope (no flag). `supportsStepBack: false` (luna has no reverse-exec).
- **Alternative rejected:** hand-rolling the DAP wire protocol — `@vscode/debugadapter`
  is the off-the-shelf framework the architecture rule says to reuse (don't rebuild
  the DAP framework; build only the SNES-specific mapping).
- **Source:** doc-researcher 2026-06-27 (VS Code debugger-extension guide,
  `@vscode/debugadapter` 1.68.0, DAP spec, mock-debug sample).

### D-019 — Slice the debugger; foundation (parser + client) first, Node-tested
- **Decision:** P2.1 ships in verifiable slices. **P2.1a = the pure, Node-testable
  foundation:** `src/sym.ts` (the `.sym` parser) + `src/lunaMcp.ts` (the MCP
  client), tested **against the real `.sym` and the real luna binary** (the
  Extension Development Host can't be driven headlessly here, so the DAP glue
  isn't offline-testable — but its substrate is). **P2.1b = the `LunaDebugSession`**
  wiring the two into the VS Code debug UI.
- **Why:** "doucement" — each slice small enough to verify end-to-end and commit
  coherently. The de-risk (D-016) already proved the backend; this turns it into
  tested code.

---

## 2026-06-27 — P2.2a (debugger memory view + evaluate)

### D-020 — Memory model: CPU-bus reads via `peek_memory`; `0x`-prefixed refs
- **Decision:** `readMemoryRequest` and `evaluateRequest` read the **CPU bus**
  (`peek_memory` → `{bytes:[…]}`), covering **WRAM / ROM / MMIO** — the address
  space the 65816 sees. DAP `memoryReference`s are emitted as **`0x` + 6 hex
  digits** (24-bit, e.g. `0x008365`) and parsed back with `parseAddress`
  (accepts `0x…`, `$…`, `BB:OOOO`). `peek_memory`'s window is one bank
  (offset/count are 16-bit) so reads are **clamped to the bank** and the shortfall
  reported as `unreadableBytes`.
- **`evaluateRequest`** resolves a `.sym` symbol first, else a literal address
  (`resolveExpr`), reads the first byte, and returns `result` + a
  `memoryReference` so the hex viewer opens there. Register variables also carry
  a `memoryReference` (PC at PB:PC; 16-bit regs at bank 0).
- **VRAM / ARAM deferred:** they are **not** in the CPU address space, so they
  need a distinct memory-reference scheme routing to `peek_vram` / `peek_aram`
  (P2.2b). **CGRAM / OAM have no MCP peek tool at all** in the pinned binary
  (D-016) → a luna RFE.
- **Grounded:** `peek_memory(0x00,0x8365,6)` on the real binary returns
  `[C2,10,E2,20,A9,8F]` = `REP #$10 / SEP #$20 / LDA #$8F` (InitHardware's init).
  DAP `ReadMemory`/`Evaluate` field shapes from the installed
  `@vscode/debugprotocol` 1.68 `.d.ts`.
- **Capabilities added:** `supportsReadMemoryRequest`, `supportsEvaluateForHovers`.

---

## 2026-06-27 — P2.2b (data / memory-watch breakpoints)

### D-021 — Data breakpoints honour one watch per Continue; `readWrite`→write
- **Decision:** DAP data breakpoints map to luna `run_until_mem_write|read`.
  `dataBreakpointInfoRequest` resolves a `.sym` symbol or literal address to a
  `dataId` (the `0x…` memoryReference); registers (the Registers scope) return
  `dataId: null` (not memory-backed — and single-letter reg names would otherwise
  parse as hex addresses). `accessTypes: ['read','write','readWrite']`.
- **One condition per Continue (the D-016 gap, made explicit):** luna watches a
  **single** address per run. So Continue honours, in order: a single data
  breakpoint (`run_until_mem_*`, exact) → a single PC breakpoint (`run_until_pc`,
  exact) → multiple PC breakpoints (chunked single-step scan, may overshoot). When
  a data breakpoint coexists with other breakpoints, **only the first data
  breakpoint is honoured that Continue**, and an `OutputEvent` warns. `'readWrite'`
  watches **writes** (`run_until_mem_*` is one kind per call).
- **Caveat (D-016):** mem-watch is **bank-exact, not mirror-folded** — set the
  address in the bank the code executes from (`$80:..` FastROM, `$00:..` LoROM).
- **Verified end-to-end vs real luna:** a write data breakpoint on `$2100`
  (INIDISP) stops at PC `0x836B` inside `InitHardware` — the exact instruction
  that writes it.
- **Capability:** `supportsDataBreakpoints`. DAP field shapes from
  `@vscode/debugprotocol` 1.68 `.d.ts`.

---

## 2026-06-28 — Integration-test harness (`@vscode/test-electron`)

### D-022 — Add the VS Code Extension Host integration harness
- **Decision:** add `@vscode/test-cli` + `@vscode/test-electron` so a second test
  tier runs **inside a real VS Code Extension Development Host**, exercising the
  `vscode`-importing glue the Node tier (`test/run.js`) cannot: command
  registration, and the **luna debug adapter end-to-end through the real debug
  machinery** (a `DebugAdapterTrackerFactory` captures DAP traffic; the test
  asserts a `stopped(entry)` event after `vscode.debug.startDebugging`).
- **Two tiers, on purpose:** `npm test` = fast Node tier (pure modules + the DAP
  session driven directly), the everyday gate. `npm run test:integration` = the
  heavy tier (downloads a full VS Code, ~260 MB, into `.vscode-test/`), run before
  shipping glue changes. The Node tier stays the default because it's seconds, not
  minutes, and needs no display.
- **Layout:** integration tests in `src/test/*.test.ts`, compiled by a **separate
  `tsconfig.test.json` → `out/` (CommonJS)** — loaded by the host, **not** bundled
  by esbuild. The extension tsconfig **excludes `src/test`** (Mocha globals would
  break its `types:["node"]` check). `.vscode-test.mjs` opens the **real
  `aim_target` example** as the workspace so the debug-config provider resolves the
  ROM + pinned luna from its Makefile. `out/`, `.vscode-test/`, and the harness
  configs are git- and vsce-ignored.
- **Verified runnable here:** VS Code **1.126.0** (linux-arm64) on the present
  `DISPLAY=:0` — no `xvfb` needed; 3/3 pass incl. the live debug session. On a
  headless CI box wrap with `xvfb-run -a` (the runner needs a display even for
  non-UI tests). Not root → no `--no-sandbox`.
- **Source:** doc-researcher 2026-06-28 (`@vscode/test-cli` 0.0.x, `test-electron`
  3.x, the `defineConfig` shape, the CI `xvfb-run -a` pattern).

---

## 2026-06-28 — P2.2c (debugger viewers) — palette viewer

### D-023 — CGRAM palette viewer: webview fed by a custom DAP request off `state`
- **Decision:** `Cooper: Show Palette (CGRAM)` renders the **live palette at the
  current debug stop** as a webview (16×16 swatch grid). The data path is a
  **custom DAP request** `cooperPpu` on `LunaDebugSession` → reads `state.ppu`
  and returns `{ cgram, oam, bgmode, inidisp, backdrop }`; the command calls
  `vscode.debug.activeDebugSession.customRequest('cooperPpu')` and renders.
- **Works around the D-016 gap:** there is **no MCP `peek_cgram`/`peek_oam`**, but
  the `state` snapshot **already includes** `ppu.cgram` (256 assembled **15-bit
  BGR555 words**, not raw bytes — grounded: index 1 = `32767` = white) and
  `ppu.oam_full` (544 bytes). So CGRAM/OAM are reachable without a new luna RFE.
- **Decode (pure, `src/ppu.ts`):** BGR555 `0bBBBBBGGGGGRRRRR` → RGB-8, each 5-bit
  channel expanded `(v<<3)|(v>>2)`. `renderPaletteHtml` emits a self-contained
  doc with CSP `default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'`,
  `enableScripts: false` (no JS needed). One reused panel.
- **Verified both tiers:** Node tier — decode (white/black/red-low/blue-high),
  256-swatch HTML, and `cooperPpu` returning 256 words against the real binary;
  **integration tier** — the custom request + `cooper.showPalette` webview command
  through a real Extension Host debug session (D-022).
- **Next viewers (same pattern):** OAM (sprite list from `oam_full`), VRAM tiles
  (`peek_vram` + bpp + a chosen sub-palette) — both decode-pure + webview.

### D-024 — OAM sprite viewer (same pattern; v0.7.0)
- **Decision:** `Cooper: Show Sprites (OAM)` decodes `state.ppu.oam_full` (544
  bytes = 512 low table [4 B × 128: X, Y, tile, attr] + 32 high table [2 bits ×
  128: bit0 = X high, bit1 = size]) into 128 sprites and renders a webview table.
  Reuses the existing `cooperPpu` request (it already returns `oam`) — no adapter
  change. `pure decodeOam` + `renderOamHtml` in `src/ppu.ts`.
- **Grounded:** aim_target shows 2 on-screen sprites — player X=124 Y=107 (tile 0),
  target X=200 Y=59 (tile 1); `y === 240` is the SDK's "hidden" convention.

### D-025 — VRAM tile viewer: planar decode + zero-dep PNG (v0.8.0)
- **Decision:** `Cooper: Show Tiles (VRAM)` reads `peek_vram` (via a new custom
  request `cooperVram {offset,count}` on the adapter) + the CGRAM (via `cooperPpu`),
  decodes planar SNES tiles, colours them with a sub-palette, and shows a **PNG in
  a webview `<img>`** (data URI, `image-rendering: pixelated`, upscaled ×4).
- **Pure `src/tiles.ts`:** `decodeTile(bytes, base, bpp)` — planar layout
  `base + (plane>>1)*16 + row*2 + (plane&1)`, pixel = Σ bit<<plane; `tilesToRgba`;
  and a **minimal PNG encoder** (RGBA colour-type-6, manual CRC32, `zlib.deflateSync`
  for IDAT — `zlib` is a Node builtin, kept external by esbuild `platform:'node'`,
  **no new dependency**). Render to PNG (not a `<canvas>`+JS) keeps the webview
  script-free and the output Node-testable.
- **MVP fixed:** 4bpp, first `0x4000` bytes (512 tiles), 16 tiles/row, CGRAM
  sub-palette 0. bpp/offset/palette selectors are a follow-up (QuickPick).
- **Verified — including visually:** Node tier — value-exact `decodeTile` (4bpp
  plane bits → 1/2/4/8; 2bpp → 3), valid PNG signature/IHDR, real `cooperVram` →
  PNG; integration — `cooper.showVram` in the real host. And a generated PNG from
  aim_target's live VRAM **renders recognisable font glyphs** (decode confirmed
  visually, not just "valid PNG bytes").
- **Grounded:** `peek_vram {offset,count}` → `{bytes}`; aim_target tile 1 is a
  font glyph (column-3/4 bits).

---

## 2026-06-28 — Helper polish (C3): compile_commands.json

### D-026 — Engine-agnostic C config via `compile_commands.json` — ⛔ REVERTED (0.9.1)
> **Reverted same day.** The premise ("lets you use cpptools instead of clangd")
> doesn't reduce friction: cpptools also needs an install, so there is **no
> zero-install path**. The command only added a second C-config surface alongside
> `.clangd` → confusion for the "simple, fun IDE" goal. C support stays one path:
> `.clangd`. Lesson: don't add a config format to dodge an install that's
> unavoidable anyway. The real simplification is **auto-config + one-click clangd
> download**, not more commands. (Kept below for the record.)

- **Decision:** `Cooper: Generate compile_commands.json` writes a JSON Compilation
  Database at the project root, one entry per `.c` file, using the **same flags as
  the `.clangd` config** (SDK include + `-std=gnu11` + the `-Wno-*` mirror, D-008).
  This is the **engine-neutral** config: clangd auto-discovers it, and the MS
  C/C++ extension reads it via `C_Cpp.default.compileCommands` — so a user can pick
  *either* LSP and still get diagnostics that match the build's clang lint.
- **Why:** answers "clangd feels heavy / can I use cpptools?" without forking the
  config. clangd stays the recommended engine (same frontend as the build,
  portable to VSCodium/OpenVSX — D-007), but Cooper no longer ties the user to it.
- **Pure `renderCompileCommands`/`compileCommand` in `clangdConfig.ts`** (argv[0] =
  `clang`, `directory` = the file's dir, absolute `-I` for SDK + file dir). The
  command gathers files via `workspace.findFiles('**/*.c')` (excluding build dirs).
- **Verified:** Node — structure + the **emitted command actually parses with
  clang** (close-the-loop); integration — the command writes/reads a real
  `compile_commands.json` in the Extension Host. The `int`=2 caveat is unchanged
  (host target; authority = the `cc65816` build).

---

## 2026-06-28 — Frictionless C onboarding: auto-`.clangd`

### D-027 — Auto-configure clangd on opening a C file (zero-step C support)
- **Decision:** when a C file in an OpenSNES project is opened, Cooper writes the
  `.clangd` **automatically** — no command to run. Activation `onLanguage:c`;
  `onDidOpenTextDocument` (+ a scan of already-open editors) → `autoConfigureClangd`.
- **Fixes the three real frictions found in a live test (`test_vscode/shmup_1942`):**
  1. **Subfolder projects:** the project is resolved from the **active file's
     nearest Makefile** (`findProjectDir` walks up for a `Makefile` referencing
     `OPENSNES`), not the workspace root.
  2. **Out-of-tree projects:** when the SDK can't be auto-resolved (the Makefile's
     `$(shell cd ../../..)` points outside the SDK), a **single** picker prompt
     sets `cooper.opensnesPath`, then writes the `.clangd`.
  3. **"I see nothing":** the missing piece was the clangd *binary*; the `.clangd`
     is now guaranteed present so clangd works the moment it's installed (one-click
     `clangd: Download language server`).
- **Guardrails (per [[cooper-simplicity-over-features]]):** never overwrites an
  existing `.clangd`; de-dupes per project per session; opt out with
  `cooper.autoConfigureClangd: false`. The manual `Configure clangd` stays as a
  fallback / re-run. **Fewer steps, not more** — the aspiration is "open the
  project → it just works".
- **Verified both tiers:** Node — `findProjectDir` (subfolder walk-up, null
  outside a project); integration — opening `main.c` in the Extension Host
  **auto-writes a correct `.clangd`** (SDK include + `-std=gnu11`).

---

## 2026-06-28 — The Cooper sidebar (GUI layer, step 1)

### D-028 — A clickable sidebar (activity-bar view) — the "it's an IDE" layer
- **Decision:** add a **Cooper activity-bar container + a `cooperTree` TreeView**
  that surfaces everything as **clickable** — no palette hunting. Sections:
  **PROJECT** (ROM + built status, SDK), **BUILD & RUN** (Build / Run-Preview /
  Debug), **PPU VIEWERS** (Palette / OAM / VRAM), **SYMBOLS** (the user's own
  functions). Answers the user's product critique ("I want a graphical IDE like
  GitLens, not 1000 keyboard shortcuts" — chosen from 3 SVG mockups: sidebar /
  webview-dashboard / codelens; **sidebar first** as the native, fast backbone).
- **All backend reused** — the tree items just invoke the existing commands; zero
  new backend. Two **new interactions**: a tree **Debug** that starts the luna
  session with an explicit ROM path (so subfolder/out-of-tree projects work), and
  **clicking a symbol sets a function breakpoint** (`vscode.FunctionBreakpoint`).
- **SYMBOLS = the user's functions, not the SDK's:** C function definitions parsed
  from the project's `.c` files, **intersected with the `.sym`** (so only names
  that really made it into the ROM show, with their address). Pure
  `extractCFunctions`/`userFunctions`/`buildTreeModel` in `src/sidebar.ts`.
- **Project resolution is subfolder-aware** (active file's nearest Makefile, else
  a workspace scan for a `Makefile` referencing `OPENSNES`) — same fix as D-027.
- **Verified both tiers:** Node — model + symbol intersection (`main` from
  aim_target); integration — the view container/view are contributed and the
  commands register. Mockups in `/tmp/cooper_ui_{1,2,3}.png`.
- **Next GUI steps (deferred):** the webview **dashboard/home** (mockup #2) and
  **CodeLens** inline actions (#3) layer on top of this.

---

## 2026-06-28 — Build for standalone projects: pass `OPENSNES=` to make

### D-029 — Cooper passes `OPENSNES=<sdk>` to `make`; build runs in the project dir
- **The bug (user-found):** `make` failed with `/home/make/common.mk: No such
  file or directory`. The SDK example Makefile computes
  `OPENSNES := $(shell cd ../../.. && pwd)` — which only resolves correctly when
  the project sits **inside** the SDK at `examples/<cat>/<name>/`. For a **standalone
  developer project** (their own repo + assets, OpenSNES installed separately as a
  "user release"), that relative climb points at garbage.
- **The user's architectural point (correct):** there are **two distinct things** —
  (1) the developer's project (only their code/assets), and (2) the OpenSNES release
  referenced by a path (`cooper.opensnesPath`). The build must use **(2)**, not the
  Makefile's self-computed guess.
- **Decision:** Cooper runs **`make OPENSNES=<resolved sdk>`** — a command-line
  variable **overrides** the makefile's `:=` assignment in GNU make (verified:
  `make OPENSNES=/WRONG` looks for `/WRONG/make/common.mk`; `make OPENSNES=<sdk>`
  builds). Cooper already knows the SDK (the setting / detection), so it injects it.
  Also: the build now runs in the **resolved project dir** (subfolder-aware, like
  D-027/D-028), not the workspace root. `buildMakeArgs(sdk, target)` (pure) emits
  `["OPENSNES=<sdk>", target?]`.
- **Verified:** Node — `buildMakeArgs` + a close-the-loop that `make
  OPENSNES=<sdk>` actually builds `aim_target.sfc`.
- **Bigger picture (for the OpenSNES release & scaffolding):** the example
  Makefiles are SDK-internal; a clean **standalone-project template** should use
  `OPENSNES ?= …` (overridable) and never the `$(shell cd ../../..)` climb. This is
  the right home for the future **`Cooper: New Project`** scaffolding — generate a
  project that takes the SDK from outside. For now, the `OPENSNES=` pass-through
  makes existing Makefiles work from anywhere.

---

## 2026-06-28 — luna resolution + test against a real standalone project

### D-030 — Robust luna resolution (file/dir/PATH); test on a standalone fixture
- **The bug (user-found, RUN failed "luna not found"):** the user's
  `cooper.lunaPath` was `~/bin/luna` — a **directory** (a luna user-release unzips
  to a folder with `luna` + `luna-gui`), but the binary is `~/bin/luna/luna`.
  `resolveLunaPath` did `fs.existsSync(configured)` → true for the directory →
  Cooper tried to exec a folder.
- **Why it slipped through:** luna is **released separately** from the SDK, so its
  location is user-specific. Cooper's resolver was dev-centric
  (`<sdk>/tools/luna-test/bin/luna`).
- **Decision:** `resolveLunaPath` now accepts the configured path as a **binary OR
  a directory** (looks for `luna`, `bin/luna`, `tools/luna-test/bin/luna` inside),
  validates it's a **file**, and adds a **PATH** fallback. Order: configured →
  SDK pinned → PATH. Setting doc updated ("binary or folder").
- **Process fix (user demand — "reorient your tests on my project; I won't be your
  QA"):** the test corpus used only the SDK's **in-tree** `examples/` (canonical
  layout), so it never exposed standalone/out-of-tree/luna-dir bugs. Added an
  in-repo **standalone fixture** `test/fixtures/standalone/` (a project NOT under
  the SDK) and a test that **builds it with the `OPENSNES=` override** — the real
  user scenario, reproducible. Going forward, verify against the standalone fixture,
  not just in-tree examples. See [[cooper-test-on-standalone-projects]].
- **Verified:** Node — `resolveLunaPath` (file / **directory** / PATH / null) +
  the standalone fixture builds out-of-tree; the user's exact `luna run …` produced
  a 22 KB screenshot of their shmup.

---

## 2026-06-28 — The Cooper dashboard (GUI layer, step 2)

### D-031 — "Cooper: Home" dashboard webview (mockup #2)
- **Decision:** add a **`Cooper: Home` webview** — the graphical dashboard the user
  picked (mockup #2): big **Build / Run / Debug** buttons, a **live preview
  thumbnail** (luna screenshot), and **Palette / Sprites / Tiles** cards, with a
  status line (SDK / luna / ROM). Opened from the **🏠 button in the Cooper sidebar
  header** or `Cooper: Open Dashboard`.
- **Styled with VS Code theme variables** (`var(--vscode-button-background)`, …) so
  it matches the user's theme — native-feeling, not a hard-coded skin.
- **Interactive, safely:** `enableScripts: true` with a strict CSP — `script-src
  'nonce-…'`, `img-src <cspSource> data:`. The inline script only does
  `postMessage({command})` on click; the extension dispatches to the existing
  commands (zero new backend). The preview is generated by the refactored
  **`generatePreviewPng`** (shared with `Cooper: Preview`) and pushed back as a
  base64 data URI. Project name is HTML-escaped.
- **Pure `renderDashboardHtml` in `src/dashboard.ts`** (markup is Node-testable);
  the panel/messaging glue is thin.
- **Verified both tiers:** Node — structure (7 actions, nonce-gated script,
  `data:` images, status, escaping); integration — `cooper.home` **opens the
  webview in a real Extension Host** (CSP/script load OK). No headless HTML
  renderer here, so the *pixel* look leans on mockup #2 (theme-var styled).
- **GUI layer now:** sidebar (#1, D-028) + dashboard (#2). CodeLens (#3) is next.

---

## 2026-06-28 — Self-healing debug config

### D-032 — Debug re-resolves the ROM when `launch.json` is stale
- **The bug (user-found):** clicking Debug/F5 did **nothing** — their `launch.json`
  `program` still pointed at `${workspaceFolder}/shmup_1942/shmup_1942.sfc` (an old
  subfolder layout) after they flattened the project to the root. The config
  provider saw `program` set, `fs.existsSync` false → rejected → silent no-op.
- **Decision:** `LunaConfigProvider.resolveDebugConfiguration` now uses a configured
  `program` **only if it exists**; otherwise it **re-resolves the ROM** from the
  project (subfolder-aware `resolveProjectDir` + Makefile `TARGET`). A stale or
  missing `program` self-heals; the provider is now async. (Mirrors D-027/D-029:
  don't trust a hardcoded path — resolve from the project.)
- **Verified on the user's real setup:** their **luna 1.3.0** release (`~/bin/luna/`,
  a directory — D-030) + their `shmup_1942.sfc`; a breakpoint on `enemies_update`
  hits exactly at `0x84AB` with registers readable. The adapter (built against the
  pinned 1.1.0) is compatible with their 1.3.0.

---

## 2026-06-29 — Documentation layer

### D-033 — In-editor onboarding via `contributes.walkthroughs`
- **Decision:** ship a **Get Started walkthrough** (VS Code's Welcome page) as the
  in-editor, graphical complement to `docs/USER_GUIDE.md` — 6 steps (tools →
  sidebar → build → run → debug → PPU) with screenshots, one-click `command:`
  buttons, and `completionEvents` so steps check off as the user acts
  (`onSettingChanged:`/`onView:`/`onCommand:`). Opened auto on install, from the
  panel header (🎓), or `Cooper: Get Started` (`workbench.action.openWalkthrough`
  with `opensnes.cooper#cooper.gettingStarted`).
- **Pure manifest, no runtime** except the one open-command. **Media lives under
  `media/`** (NOT `docs/`, which `.vscodeignore` excludes) so it's packaged — a
  Node test asserts every step image exists + lives under `media/` (guards the
  blank-box gotcha), and an integration test opens the walkthrough in a real host.
- **Source:** doc-researcher 2026-06 (`contributes.walkthroughs` schema, media
  `oneOf`, completionEvents, command-link buttons, packaging gotchas).
- Part of the **"document it" discipline step** (workflow.md step 6).

---

## 2026-06-29 — Source-level C debug (P7) — the cproc path

### D-034 — Cheapest real path: cproc emits `dbgloc`, Cooper joins to C lines
- **Decision:** make C source-level debug work via path (b) from the de-risk —
  the compiler emits per-statement line info, Cooper joins it to the existing
  PC→asm-line table. Verified end-to-end with **correct** mappings (PC 0x6218 →
  `main.c:198` = `textPrintAt(...)`).
- **Compiler side (in the `opensnes` repo — author to commit there with its own
  test process):**
  - `cproc/stmt.c`: emit `funcdbgloc(f, tok.loc.line)` per statement;
    `cproc/qbe.c`: `funcdbgloc()` → a `IDBGLOC` inst; `cproc/ops.h`:
    `OP(IDBGLOC,"dbgloc")`; `cproc/cc.h`: the decl. QBE already parses `dbgloc`.
  - `qbe/w65816/emit.c`: `case Odbgloc` → `\t; @cline <line>\n` (a **WLA-safe
    comment** — NOT the shared `.loc`, which WLA rejects; line is an `RInt`, read
    via `rsval`). Verified: ROM bytes unchanged, still runs.
  - Built with `wla -i` + `wlalink -A`, the `; @cline` markers survive into
    `main.c.wrap.asm` and the `.sym` gains `[addr-to-line]` (PC→wrap-asm:line).
- **Cooper side (`src/sym.ts`, this commit):** `parseSym` now also reads
  `[source files v2]`; `buildCLineMap` joins PC→asm-line (`.sym`) × asm-line→C-line
  (`@cline` markers in the wrap.asm) → **PC ↔ `main.c`:line** both ways
  (`addrToSource`, `sourceToAddr`, nearest-preceding `cSourceForAddr`). Pure,
  Node-tested against the real aim_target build.
- **How a user gets it:** build with the two extra flags (Cooper will pass them),
  and use a compiler built from the patched cproc/QBE. **Next (P7b):** wire the DAP
  adapter — `stackTrace` frame `source`+`line` (highlight `main.c`), source
  breakpoints (gutter → PC via `run_until_pc`).
- **Source:** de-risk agent (cproc/QBE/wla grounding); empirical build + join.

### D-035 — Source-level DAP wiring + auto debug-info flags (P7b)
- **Decision:** wire the C-line map into `LunaDebugSession`: `launchRequest` builds
  `buildCLineMap` from the `.sym` + the generated asm; `stackTraceRequest` attaches
  the frame `source` (`main.c`) + line (→ VS Code highlights it); a new
  `setBreakPointsRequest` resolves **gutter (source-line) breakpoints** to PCs
  (`resolveLine` → nearest C line with code) and `run_until_pc` stops there.
  Function + source PC breakpoints are unified (`pcBreakpoints()`); the stop reason
  is `'breakpoint'`.
- **Builds emit debug info by default:** `buildMakeArgs` now also passes
  `AS=<sdk>/bin/wla-65816 -i` and `LD=<sdk>/bin/wlalink -A` (overriding AS/LD adds
  the flags without touching the Makefile's `ASFLAGS`). Harmless to the ROM; with
  the patched cproc it yields C-line info, otherwise asm-line. No new setting.
- **Verified headlessly end-to-end:** a source breakpoint on `main.c:237` →
  Continue → the stopped frame carries `source=main.c` + a C line (143→145 Node
  tests); integration green. This resolves the "Unknown Source" gap (D-032).
- **Caveat:** needs a compiler built from the patched cproc/QBE; without it the
  debugger gracefully falls back to symbol/asm level (no C-line frames).

### D-036 — C-line stepping (source-level Step Over/Into/Out)
- **Decision:** make the step requests advance by C source line, reusing the
  `CLineMap` (no compiler work). `stepLine(mode)` single-steps until `stepStops`
  fires: `in` = first changed C line; `over` = changed line once SP ≥ start (so
  call bodies are skipped — entered calls are fast-forwarded with
  `run_until_pc(pc+callLen)`); `out` = SP > start (frame returned). SP grows DOWN
  on the 65816, so deeper = smaller SP. Stops early on a user breakpoint PC; falls
  back to one instruction when the PC has no C-line.
- **Pure/tested:** `callLen` (JSR=3/JSL=4) and `stepStops` are unit-tested; the
  real-binary DAP test confirms a Step Over moves to a different `main.c` line.
- **Limitation:** the step-over fast-skip only recognises JSR/JSL opcodes; other
  call-like flows single-step (bounded by a 200k budget).

## 2026-06-30 — Typed local variables (G4)

### D-037 — `-g` no-promote + named alloc temps → typed Locals
- **Decision (full G4, per the de-risk):** make the C locals viewable+typed by
  keeping them memory-resident and threading their name/type through to the asm.
- **Compiler (OpenSNES repo — author to commit):**
  - `qbe/main.c`: a `-g` flag gates `promote(fn)` (allocas would otherwise become
    SSA temps with no stable address). Verified: no-promote still builds a correct,
    running ROM (only larger/slower).
  - `cproc/qbe.c` (`dbgTempName` in `funcalloc`): encode each named local's
    `<class><bytes>_<cname>` into its alloc temp's `u.name` (e.g. `u2_pad`,
    `g8_cfg`); QBE preserves the name. class = u/s/p/a/g/f/v.
  - `qbe/w65816/emit.c`: for each named alloc temp emit `; @dbglocal <name>
    <(allocslot+1)*2>` (the frame-base byte offset).
  - `bin/cc65816`: pass `-g` to qbe when `CC65816_G` is set.
- **Cooper (`src/sym.ts`, `src/lunaDebug.ts`):** `parseLocals` (per-function
  typed locals from `@dbglocal`), `parseFunctions`/`buildFuncRanges`/
  `enclosingFunction` (PC → enclosing C function — the nearest-preceding *function
  entry*, since `.sym` interleaves string/block labels so the nearest *label* is
  unreliable). A "Locals" scope reads `frameBase + offset` (SP at a stop, bank 0)
  and `formatLocal` renders it typed. `buildMakeArgs`/the build task set
  `CC65816_G=1`.
- **Verified end-to-end:** stop in `on_update`, step over the prologue → `pad`
  reads as `u16` with a value; all locals typed. 171 Node + 8 integration.
- **Limitations:** frame base assumed == SP at a stop (true at statement
  boundaries); aggregates/pointers shown as raw bytes/hex (no member expansion
  yet); debug (`-g`) builds are unoptimised, so timing differs from release.

### D-038 — Aggregate expansion via a cproc `.dbg` sidecar
- **Decision:** expand struct/array locals into fields/elements. The member
  **names** can't fit the temp-name channel (used for scalar locals), and QBE type
  defs carry no field names — so cproc writes a **`.dbg` sidecar** (the only clean
  channel for named, nested type trees), joined with the `@dbglocal` frame offset.
- **Compiler (OpenSNES repo):** `cproc/qbe.c` `writeDbgType` emits a recursive
  grammar per aggregate local — scalar `u2`/`p4`, array `a<size>[<elem>;<count>]`,
  struct `g<size>{name:<type>@off;...}` — to `$CC65816_DBG`; `bin/cc65816` sets
  that env to `<output>.dbg` under `-g`. (Every node carries its byte size, so
  Cooper knows array strides.)
- **Cooper:** `parseAggregates` (recursive-descent parse of the grammar, keyed
  `func<space>local`), `aggChildren` (pure: field/element child descriptors), and
  dynamic `variablesReference`s (reset per stop in `scopesRequest`) so structs →
  fields and arrays → elements expand recursively, each read from
  `frameBase + offset` and typed via `formatLocal`.
- **Verified:** `parseAggregates` on the real `main.c.dbg` (`cfg` → init/update)
  + synthetic array/nested; `aggChildren` offsets/strides/cap. 179 Node + 8
  integration. (Live struct expansion reuses the scalar-local read path, which is
  integration-tested.)
- **Gotcha fixed:** a stray NUL byte had slipped into the map-key separator in
  `sym.ts` (invisible; made `grep` treat the file as binary) — normalised to a
  space across `sym.ts`/`lunaDebug.ts`/`test`.

## 2026-07-02 — Release vs debug builds

### D-039 — Build/Run = release, Debug = auto `-g`
- **Decision:** Cooper's Build and Run/Preview do a **release** build (`make` with
  only `OPENSNES=`); the **Debug** launch does a `-g` build (`wla -i` /
  `wlalink -A` + `CC65816_G=1`) automatically, just before starting the session.
- **Why:** debug metadata is **not codegen-neutral** — the OpenSNES CI proved that
  a `-g` build renders differently from release for 5 examples (framebuffer hash
  mismatch). So it must never leak into the ROM you preview/ship. Previously Cooper
  passed `CC65816_G=1` on *every* build, so Run/Preview showed debug codegen.
- **How:** `buildMakeArgs(sdk, target, debug)` gates the `-i`/`-A` flags;
  `makeTask(..., debug)` gates the `CC65816_G` env; `runMakeAndWait` runs a task to
  completion; `LunaConfigProvider.resolveDebugConfiguration` calls it with
  `debug=true` before launch (make is incremental, so the rebuild is cheap) — which
  also means **Debug no longer needs a manual Build first**.
- **Grounded:** the shipped `~/bin/opensnes` release gates debug emission behind
  `CC65816_G` (verified: 0 `dbgloc` without it, present with it), so a release
  build is byte-identical to the non-debug compiler.

## 2026-07-02 — Asset editors (C6): palette first

### D-040 — SNES palette editor edits the indexed PNG's PLTE
- **Decision:** the first asset editor is a **palette editor**, and it edits the
  **indexed PNG** that `gfx4snes` consumes (its `PLTE`), not a `.pal` — because the
  `.pal` is a build artifact. Conversion stays in `make` (Cooper's "edit source"
  rule); hardware truth stays with luna (the existing live CGRAM viewer).
- **Grounded (SDK):** CGRAM is **15-bit BGR555**, `RGB(r,g,b)=(b<<10)|(g<<5)|r`,
  channels 0–31 (`lib/include/snes/video.h:83`); gfx4snes converts the PNG's 8-bit
  palette with `>>3`. So the editor works in 5-bit space and expands back with
  `(v<<3)|(v>>2)` (round-trips `>>3`). Verified: a real asset's PNG palette `>>3`
  equals its gfx4snes-emitted `.pal` **exactly** (16/16). CGRAM map: 0–127 BG,
  128–255 sprites (8 palettes of 16, `sprite.h:75`); entry 0 transparent; Mode 0
  BG layers each own a block.
- **Shape:** pure `pngPalette.ts` (chunk-level PLTE read/write — pixels untouched —
  + BGR555 conversions, Node-tested against a real SDK PNG) + pure
  `paletteEditor.ts` (webview HTML, nonce-CSP) + thin `extension.ts` glue
  (`cooper.editPalette`, explorer context menu on `.png`).
- **Corrections from grounding:** the graphics tool is **`gfx4snes`** (input =
  indexed PNG/BMP), not `png2snes`; `smconv` is audio. The SDK exposes **6** of the
  8 OBSEL sprite-size pairs (omits the two non-square). Mode↔bpp is documented, not
  enforced by `setMode` — the editors should enforce it.
- **Next (C6):** tile/sprite editor (size-pair enforcement) → tilemap.

### D-041 — Tile/sprite editor paints the indexed PNG's pixels
- **Decision:** the second asset editor paints the **indexed PNG's pixels** (the
  same source `gfx4snes` consumes), with an 8×8 tile grid + a sprite-cell overlay
  (8/16/32/64 — the square sizes; the 6 OBSEL *pairs* pick small/large per sprite
  at runtime, which is a game/`oamInit` concern, not a pixel one). Reuses
  `readIndexedPixels` (decode) + new `writeIndexedPixels` (re-encode IDAT, filter
  None + zlib, keeping IHDR/PLTE).
- **Verified end-to-end:** paint a pixel → `writeIndexedPixels` → `gfx4snes`
  accepts the PNG and emits a `.pic`; decode round-trips exactly; palette
  preserved. Pure `tileEditor.ts` (nonce-CSP webview) + `cooper.editTiles` glue
  + explorer context menu.
- **v1 scope:** paint/zoom/grid/save; palette strip shows the first N (4bpp = 16).
  Not yet: per-tile flip/dedup (gfx4snes `-F`), metasprite layout, undo history.

### D-042 — Tilemap: a hardware-faithful VIEWER, not a Tiled clone
- **Decision (garde-fou):** Cooper does **not** build a tilemap editor. Grounding
  showed the OpenSNES map workflow is two paths: (A) a **big PNG → `gfx4snes -m`**
  (the tile editor already covers editing that PNG; the `.map` is a derived, dedup
  artifact — no per-cell authoring), and (B) a **Tiled `.tmj` → `tmx2snes`** (Tiled
  is a best-in-class off-the-shelf tilemap editor the SDK already integrates).
  Cloning Tiled would violate "off-the-shelf everywhere except the differentiators"
  + "no parallel asset pipeline". So Cooper ships a **read-only viewer** — the
  SNES-truth Tiled can't show.
- **Grounded (SDK):** the 16-bit entry is `vhopppcc cccccccc` — tile 0-1023 (bits
  0-9), palette (10-12), priority (13), H-flip (14), V-flip (15) — from
  `gfx4snes/common.h` + `tmx2snes.c`. Legal map sizes 32×32/64×32/32×64/64×64
  (`background.h:30`). Mode 7 differs (128×128 byte map, no per-cell attributes).
- **Shape:** pure `tilemap.ts` (`parseTilemapEntries` + `assembleTilemapRgba`,
  reusing `tiles.ts` decode + `encodePng`) + `cooper.viewTilemap` glue reading the
  `.map`/`.pic`/`.pal` trio; renders via the existing `renderVramHtml`. Verified
  visually: the mode1 example assembles to its exact OpenSNES-logo background.
- **v1 scope:** 32-wide (single 32×32 screen — the common case). Follow-ups: 64-wide
  block de-interleave; a **live BG from luna** (peek VRAM map+tiles at a debug stop).

## 2026-07-04 — AI helper (C7)

### D-043 — C7 part 1: ship OpenSNES context via `AGENTS.md`
- **Decision:** the first C7 slice ships SDK/hardware context as an **`AGENTS.md`**
  (the converging cross-assistant standard — Copilot reads it behind a setting,
  Claude Code natively) plus a `.github/copilot-instructions.md` pointer (Copilot's
  guaranteed path). Declarative, zero runtime, immediate value. `cooper.configureAI`
  writes them; `renderAgentsMd`/`renderCopilotInstructions` are pure + Node-tested.
- **Content** distils this session's grounding: `int`=2 (cc65816) + fixed-width
  types; BGR555/CGRAM (0–127 BG, 128–255 sprites, colour 0 transparent); BG modes↔
  bpp; sprite limits + OBSEL sizes; tilemap entry `vhopppcc cccccccc` + sizes;
  edit-source-PNG assets (gfx4snes); build (release) / debug (`-g`) / verify-in-luna.
- **Grounded (doc-researcher, current 2026):** MCP registration paths for the next
  slices — VS Code extension API `contributes.mcpServerDefinitionProviders` +
  `vscode.lm.registerMcpServerDefinitionProvider` + `McpStdioServerDefinition`
  (zero-config for Copilot); `.mcp.json` (`mcpServers`) for Claude Code/Cursor;
  `.vscode/mcp.json` (`servers`). OpenSNES MCP = `@modelcontextprotocol/sdk` v1.x
  (pin; v2 beta), pure Node. Verify loop = orchestration over luna's 17 MCP tools.
- **C7 part 2 (done):** `Configure AI` also **registers luna as an MCP server** by
  writing config files — `.vscode/mcp.json` (key `servers`, VS Code/Copilot) +
  `.mcp.json` (key `mcpServers`, Claude Code/Cursor), merging into any existing
  file, skipping one it can't parse. **Chose files over the extension
  `mcpServerDefinitionProviders` API on purpose:** the API would force
  `engines.vscode` from `^1.75` to ~`1.101` (kills the wide-reach value), whereas
  files work on any VS Code + every assistant. Pure `mcpConfig.ts`
  (`mergeVscodeMcp`/`mergeProjectMcp`), Node-tested.
- **Next C7 slice:** (3) an OpenSNES MCP (lookup_api, hardware_constraint) + the
  build→luna verify loop (mostly orchestration over luna's existing MCP tools).

### D-044 — C7 part 3: the OpenSNES MCP server (C7 complete)
- **Decision:** ship an **OpenSNES MCP server** exposing the SDK as queryable tools
  (`lookup_api`, `search_api`, `list_headers`, `hardware_constraint`) so the AI
  reads exact signatures/rules from the *installed* SDK (beats the static
  AGENTS.md, always matches the user's version).
- **Hand-rolled the JSON-RPC stdio server** (`opensnesMcp.ts`) instead of adding
  `@modelcontextprotocol/sdk` + `zod` — same protocol as the luna MCP *client*
  (`lunaMcp.ts`), so **no new dependency**. Dispatch (`handleMessage`) is pure +
  Node-tested; the SDK querying (`opensnesApi.ts`) is pure + tested against the real
  SDK. Bundled as a 2nd esbuild entry → `dist/opensnes-mcp.js`.
- **Registration:** VS Code MCP-provider API (`contributes.mcpServerDefinitionProviders`
  + `registerMcpServerDefinitionProvider` + `McpStdioServerDefinition`), used via
  **feature-detection + any-cast** so `engines.vscode` stays `^1.75` (a no-op on
  older VS Code — the AGENTS.md context still applies). Runs the bundled server with
  `process.execPath` + `ELECTRON_RUN_AS_NODE=1`.
- **C7 complete:** context (AGENTS.md) + luna MCP (drive/verify) + OpenSNES MCP
  (query the SDK) → write C → build → run in luna → observe → self-correct.

### D-045 — Native multi-breakpoint continue via luna's bp registry (2026-07-06)
- **Decision:** the debug adapter mirrors ALL its breakpoints (function + source-line
  PCs + data watchpoints) into **luna's native breakpoint registry** (`bp_add` /
  `bp_clear_all`) and a continue is **one `run_until_break`** at full emulation
  speed. Replaces the D-016-era fallbacks (one `run_until_*` target per run; the
  chunked single-step scan for >1 PC bp — exact but slow and overshoot-prone; the
  "only the first data breakpoint is honored" warning).
- **Grounding:** luna **v1.7.0** (source AND the pinned binary
  `../opensnes/tools/luna-test/bin/luna` — verified by a **live `tools/list`**:
  39 tools). Schemas from `crates/luna-mcp-server/src/lib.rs`: `bp_add {kind:
  'exec'|'mem', addr, symbol?, hi?, on_read?=false, on_write?=true} → {id}`;
  `run_until_break {max_steps} → {steps, hit, bp_id?, kind?: exec|read|write, pc?,
  addr?, value?}`. Exec BPs halt BEFORE their instruction and the run's first
  instruction is exempt (resume-friendly); watchpoints halt AFTER the access.
- **Semantics kept:** watch is still **bank-exact** (no mirror folding —
  `breakpoints.rs` matches the raw 24-bit range), so the D-016 bank caveat stands.
- **Verified:** Node tier drives the real binary — two exec BPs hit across two
  continues (multi-bp in one run), `bp_list` reflects the registry, and a mixed
  `mem` watchpoint on `$2100` reports `{kind:'write', pc, addr, value}`. The DAP
  suite's symbol-breakpoint continue now goes through the new path.
- **Alternative rejected:** keeping `run_until_pc`/`run_until_mem_*` (still used
  for step-over's call-skip, where a single exact target is the right tool).

### D-046 — Debug snapshots via luna save/load_state (2026-07-06)
- **Decision:** surface luna's savestates in the debugger — `Cooper: Save Debug
  Snapshot` / `Restore Debug Snapshot…` at a stop, via DAP customRequests
  (`cooperSaveState`/`cooperLoadState`). Restore emits a `stopped('restore')` so
  the UI re-reads registers/variables at the restored point. Blobs are stored as
  files under `globalStorage/snapshots/` (they can be hundreds of KB — too big
  for workspaceState) and are **ROM-hash-guarded by luna itself** (a state only
  loads against its own ROM; the restore error explains that).
- **Grounding:** `save_state {} → {state_base64, bytes}` / `load_state
  {state_base64} → {ok}` (luna-mcp-server lib.rs, pinned binary verified live).
- **Verified:** Node tier round-trip against the real binary — save, drift 5000
  steps, load, exact CPU tuple (pc/pb/a/x/y/sp) restored.

### D-047 — Disassembly viewer via luna `disasm_cpu` (2026-07-06)
- **Decision:** `Cooper: Show Disassembly (at the stop)` renders luna's own
  disassembly (64 lines from the live PC, M/X widths from the live flags) in a
  static webview (`enableScripts: false`, PC row highlighted). Cooper does NOT
  ship a 65816 disassembler — luna is the single engine (architecture rule), and
  its output is symbol-annotated because the debug adapter now `load_symbols`the
  ROM's `.sym` into luna at launch (also unlocks `symbol:` args + annotated traces).
- **Grounding:** `disasm_cpu {addr?, lines?=16, m8?, x8?} → {lines:[{addr, bytes,
  text, is_pc, symbol?}]}`; `load_symbols {path} → {count}` (lib.rs; pinned binary
  verified). Pure renderer `disasmView.ts` (Node-tested); DAP customRequest
  `cooperDisasm`.
- **Alternative rejected:** DAP-native `disassembleRequest` + VS Code's built-in
  disassembly view — it requires `supportsDisassembleRequest` plus instruction
  stepping granularity plumbing, and the built-in view is geared to
  instruction-stepping sessions; the webview is the cheapest correct slice and
  can migrate later.
- **Verified:** real-binary Node test — 8 lines at the live PC, exactly one
  `is_pc`, symbol annotations present after `load_symbols`; renderer escapes
  text and carries no scripts.

### D-048 — "Who accesses this address?" via luna mem trace (2026-07-06)
- **Decision:** `Cooper: Trace Memory Accesses (one frame)…` at a debug stop —
  prompt a symbol/address, record every bus access to that exact address over
  one frame (`enable_mem_trace` filtered `bank`+`lo..hi` → `step_until_frame` →
  `take_mem_trace`), attribute each access to its function (PC → Cooper `.sym`),
  render a static table (kind, value, PC, function, scanline/vblank). The
  machine advances one frame → `stopped('trace')` refreshes the debugger UI.
- **Grounding:** `enable_mem_trace {max_events, bank?, lo?, hi?}`,
  `take_mem_trace {} → {events:[{mclk, pc, addr, kind, value, line, hclock,
  blank, force_blank, symbol?}]}`, `step_until_frame {max_steps} → {executed}`.
  **Caveat found live:** luna interleaves `nmi`/`irq` context markers that
  bypass the address filter — the adapter keeps only `read`/`write` events.
  Watch is bank-exact (mirrors not folded) — surfaced in the prompt + the view.
- **Verified:** real-binary Node test — INIDISP `$2100` writes captured on the
  init frame, all filtered events are writes to `$2100`, and one attributes to
  `InitHardware` via the `.sym`. Pure renderer tested (escaping, vblank tag,
  empty state, no scripts).

### D-049 — Guided onboarding: arch-aware downloads + SDK debug-info check (2026-07-06)
- **Decision:** every "SDK/luna not found" error now carries a **Download
  (linux arm64)** button (host-arch detected, opens the right releases page) +
  **Open Settings**. At debug launch, Cooper reads the SDK's `cc65816` wrapper
  and warns **once per session** when it predates the Cooper debug info (no
  `CC65816_G` gate → OpenSNES < 0.26): the debugger silently falling back to
  symbol level was indistinguishable from a bug for the user.
- **Grounding:** the OpenSNES release CI publishes per-arch zips
  (`linux_x86_64`, `linux_arm64`, `windows_x86_64`, `darwin_arm64`) on `v*`
  tags; the shipped ≥0.26 wrapper carries `CC65816_G` (verified in
  `~/bin/opensnes/bin/cc65816` L89–91 and the dev tree
  `compiler/scripts/cc65816`). Pure helpers in `onboarding.ts`
  (`releaseArchTag`, `sdkSupportsDebugInfo`), Node-tested against both wrappers.
- Memory: users install by **downloading prebuilt per-arch releases** — never
  tell them to clone/compile ([[opensnes-onboarding-download-prebuilt]]).

### D-050 — New Project = copy an SDK example out-of-tree (2026-07-06)
- **Decision:** `Cooper: New Project…` scaffolds by **copying a real SDK example**
  out of the SDK tree (quick-pick over `<sdk>/examples`, `text/hello_world`
  starred as the minimal starter), rewriting its Makefile (`OPENSNES ?= <sdk>`
  absolute — plain `make` works in a terminal and `detectSdk` parses this form —
  plus `TARGET`/`ROM_NAME` from the project name), writing `.clangd`, running the
  **first build before opening** the folder (the open restarts the extension
  host), then offering Open / Open in New Window. Cooper embeds **no game
  templates**: the SDK's examples are the always-current starting points — zero
  drift when the SDK API changes (cf. the `oamSetVisible` removal), pure thin
  client of the contract.
- **Grounding:** the out-of-tree pattern = Cooper's verified standalone fixture;
  build artifacts to exclude mirror `make clean` in `make/common.mk` (`.o`,
  `.wrap.asm`, `.c.asm`, `linkfile`, `project_*.{asm,inc}`, `.sfc/.sym`…, +
  Cooper's `.dbg`). Caught in verification: `examples/` has a **build-all
  orchestrator Makefile** at its root (no `common.mk`) — the walk must not stop
  there.
- **Alternative rejected:** Cooper-embedded templates (drift + maintenance) and
  `<sdk>/templates/` (runtime boot files — crt0/hdr/memmap — not projects).
- **Verified:** Node tier — real corpus listed (>10, nested categories), real
  hello_world Makefile rewritten, scaffold to tmp copies no artifacts, and the
  scaffolded project **builds with plain `make`** (no OPENSNES on the command
  line) against the real SDK.

### D-051 — Play in luna-gui (G1, 2026-07-07)
- **Decision:** `Cooper: Play (luna-gui)` launches the built ROM in luna's
  native window, spawned **detached** (`detached: true` + `unref`, stdio
  ignored): a game session belongs to the player, not to the IDE's lifetime.
  Resolution (`resolveLunaGuiPath`, pure): configured `cooper.lunaPath` folder →
  sibling of the resolved `luna` binary (the release tarball ships both side by
  side) → PATH → null (then the arch-aware download toast). Single-engine rule
  holds: luna-gui is orchestrated as a sibling process, never embedded.
- **Grounding:** `luna-gui <rom>` takes the ROM as argv[1]
  (`luna-gui/src/main.rs:1527`, v1.7.0); SDK ≥ 0.28 detects luna-gui
  (`opensnes doctor`). The SDK's pinned harness installs only the CLI — hence
  the sibling/folder lookup against the user's unzipped luna release.
- **Verified:** synthetic-layout resolution tests (folder / sibling / absent),
  and a real launch — breakout.sfc in luna-gui on this machine: window alive,
  **60 fps with audio**, clean kill. (Not CI-testable: the Node tier runs
  headless; the GUI needs a display.)

### D-052 — Interactive VRAM viewer: bpp/offset/sub-palette (G2a, 2026-07-07)
- **Decision:** the VRAM viewer gains hardware-exact controls — **bpp 2/4/8**
  (the SNES planar formats), **window offset** into the full 64 KB, and
  **sub-palette** (CGRAM groups of 2^bpp colours: 64×4 / 16×16 / 1×256, clamped
  per bpp). Control changes re-render **from a cached snapshot** in the
  extension (no luna round-trip per tweak — a transient run costs seconds); an
  explicit "Re-read VRAM" button re-reads the machine. Pure `vramView.ts`; the
  old static `renderVramHtml` stays (the tilemap viewer uses it).
- **Grounding:** `peek_vram(offset: u16, count: u16)` (luna-api lib.rs:2407) —
  count caps at 0xFFFF, so the full 64 KB is read as **two 32 KB peeks**.
  Workaround is trivial → no upstream issue (per the issue rule: file only for
  real gaps).
- **Verified:** pure renders (toolbar, 512/1024/256 tiles per bpp, offset
  selected, sub-palette clamping 63/63 and 0/0, distinct sheets per offset) +
  the two-peek 64 KB read against the real binary.

### D-053 — CodeLens "◉ break · ▶ debug here" (G2b, 2026-07-07)
- **Decision:** a CodeLens provider on C files shows two lenses above each
  **project function** (the `.c ∩ .sym` set the sidebar already computes — only
  functions that actually made it into the ROM, so no lens on dead code):
  `◉ break` toggles the function breakpoint (existing `cooper.breakOnSymbol`),
  `▶ debug here` ensures the breakpoint then launches the debugger (new
  internal `cooper.debugHere`, not palette-contributed). Lenses re-render on
  breakpoint changes; opt-out via the `cooper.codeLens` setting (default on).
  Definition lines come from the pure `functionDefLines` (sidebar.ts, same
  loose header regex as `extractCFunctions` — the `.sym` stays the truth).
- **Gotcha (integration tier):** a test opening `main.c` must run AFTER the
  `.clangd` auto-write test — an already-open document doesn't re-fire
  `onDidOpenTextDocument`, starving that test of its trigger.
- **Verified:** pure line extraction against the real aim_target `main.c`
  (every extracted function found, lines contain the definitions), and a real
  Extension Host query (`vscode.executeCodeLensProvider`) returns both lenses.

### D-054 — Watch mode: save → rebuild → refreshed preview (G3, 2026-07-07)
- **Decision:** `Cooper: Toggle Watch` — a FileSystemWatcher over the project,
  filtered by the pure `isWatchSource` predicate (**the load-bearing part**:
  `make` writes `main.c.asm`, `*.wrap.asm`, `*.o`, the ROM, `res/*.pic/.pal/
  .map`… into the project dir, and any of those re-triggering the watcher would
  loop forever — inclusion by source extension MINUS the generated-artifact
  list). Debounced 300 ms, **single-flight with one trailing rebuild** (saves
  during a build coalesce into exactly one follow-up). The rebuild is a QUIET
  `execFileAsync make` (no task-terminal spam per save; failures go to the
  Cooper log + a status-bar error state), then the preview regenerates and the
  dashboard thumbnail updates in place. A status-bar eye shows/stops the mode.
- **Verified:** pure predicate (sources trigger; every generated artifact class
  doesn't; unrelated files don't) + real-host toggle on/off. luna-gui live
  reload stays G3-v2 (upstream luna issue, per the roadmap).

### D-055 — Memory map: WRAM ramsections + VRAM heatmap (G4, 2026-07-07)
- **Decision:** `Cooper: Show Memory Map` renders (a) **WRAM** from the `.sym`
  `[ramsections]` — the linker's own name/addr/**exact size** blocks (not a
  heuristic), with the labels inside each block as variable-level detail
  (label size = gap to the next label, bounded by the block end); and (b) a
  **VRAM occupancy heatmap** (64 × 1 KB cells) computed from the full snapshot
  Cooper already fetches — richer than luna's single `vram_non_zero` counter.
  Works at a debug stop or standalone (transient luna); static webview.
- **Grounding (real aim_target.sym):** ramsections carry SIZE
  (`7e:0300 0300 00000220 .oam_buffer`), and the linker emits **mirror
  aliases** — `.reserved_7e_mirror` @ `00:0300` is the same physical memory as
  `.oam_buffer` @ `7e:0300`. `canonicalWram` folds the system-bank low-RAM
  mirror (banks $00–$3F/$80–$BF, offset <$2000) onto $7E and same-extent blocks
  merge, so totals never double-count.
- **Verified:** against the real `.sym` — aliases merge into one 0x220 block,
  `oamMemory` attaches inside it, totals consistent; synthetic heatmap
  bucketing; static render with 64 cells.

### D-056 — Input replay v1 (G5, 2026-07-07)
- **Decision:** `Cooper: Replay Inputs…` at a debug stop — a `frame:mask`
  checkpoint script (luna's own `--input` format/semantics: replay **from
  power-on**, a checkpoint's mask holds until the next) driven over MCP
  (`reset` → per checkpoint: `step_until_frame` to the frame → `set_joypad`).
  Cooper accepts **button names** (`120:Start, 300:A+Right, 360:0`) and always
  echoes the canonical hex so scripts stay luna-CLI compatible. Ends with
  `stopped('replay')`; the last script is remembered per workspace.
- **Recording is upstream:** gap confirmed live (no input capture anywhere in
  luna v1.7.0) → **issue k0b3n4irb/luna#83** filed per the issue rule. When it
  lands, Cooper wires "record a repro" in luna-gui → replay here.
- **Grounding caveats:** `peek_memory` reads the `$2000-$5FFF` register band
  as **0 by design** — the latched pad is `state.cpu_regs.joy1`; and
  `set_joypad` only latches on the NEXT auto-read (hold ≥1 frame).
- **Verified (behavioral):** mask latches into `joy1` after auto-read; and a
  replayed `10:Right, 200:0` **drives the real game** — aim_target's sprite
  clamps at its right bound (`target_x` 200 → exactly 247), read back through
  the debugger's own `evaluate`. (The example's init eats ~50 frames — a
  too-short hold plateaus at 227, which the first test run caught.)

### D-057 — ROM validation + SD-card deploy (G6, 2026-07-07)
- **Decision:** `Cooper: Validate ROM` re-derives the internal cartridge header
  the hardware way — LoROM `$7FC0` / HiROM `$FFC0` auto-scored (complement pair
  + map-mode byte + printable title), checksum recomputed (power-of-two sum, or
  largest-power-of-two + mirrored remainder), plus copier-header, header-size
  and reset-vector checks — and renders a pass/fail report. `Cooper: Deploy
  ROM` validates then **copies to `cooper.deployPath`** (the flashcart SD mount
  — the sneakernet workflow every flashcart supports), prompting and saving the
  path on first use.
- **usb2snes deferred deliberately:** a WebSocket deploy to FXPak via
  QUsb2Snes is the natural v2, but there is **no hardware here to verify
  against**, and the discipline is "run the thing against reality" — shipping
  an unverifiable client would break it. Revisit with hardware in the loop.
- **Verified:** the checksum algorithm was prototyped against 4 real
  wlalink-built ROMs before writing the module; tests validate the corpus
  clean (LoROM, titles read back), a flipped byte fails the computed checksum,
  and a synthetic 512-byte copier header is detected while the header still
  parses.

### D-058 — Frame profiler (G7, 2026-07-07)
- **Decision:** `Cooper: Profile One Frame (CPU)` at a debug stop —
  `enable_cpu_trace(200k)` → `step_until_frame` → `take_cpu_trace`, then
  aggregate **in the adapter** (a frame is ~30–50k per-instruction events;
  megabytes of raw JSON through DAP would be silly): an instruction's cost =
  the mclk delta to the next event, grouped by luna's nearest-symbol
  annotation (base name, `+0xNN` stripped) → per-function table (mclk, instr,
  %) + a per-scanline strip (1364 mclk buckets — "when in the frame?"). Pure
  `profiler.ts`; static viewer; the machine advances one frame
  (`stopped('profile')`).
- **Grounding:** `enable_cpu_trace {max_events}` (no hidden clamp),
  `take_cpu_trace → {events:[{mclk, pc, …, symbol?}]}`; symbol annotation
  needs the launch-time `load_symbols` (D-047). The 200k ring holds a full
  frame with margin — the feared overflow (roadmap) doesn't materialize, so
  no upstream issue.
- **Verified:** pure aggregation (delta costs, base-symbol grouping, %≈100,
  strip span) + a real traced frame: >1000 events, majority symbol-annotated,
  aggregates into named functions with total mclk in the physical frame range.

### D-059 — Sprite animation preview; metasprites gated upstream (G8, 2026-07-07)
- **Decision:** G8 splits on the garde-fou. **G8a (shipped):** an animation
  preview in the tile editor — consecutive sprite cells (row-major, the
  selected 8/16/32/64 cell size) play as frames at 4–30 fps in a small canvas,
  **live on the pixels being edited** (paint a frame, watch the walk cycle
  update). Pure visualization of the PNG the user already draws — Cooper emits
  no format. **G8b (gated):** the metasprite composer + animation-table editor
  need the LIBRARY to define the consuming format first — grounded live:
  `sprite.h` has `oamDynamic*` and `object.h` a single `sprframe` per object,
  but **no metasprite tables and no declarative animation player** (games
  hand-roll frame constants, cf. likemario) → **issue k0b3n4irb/opensnes#97**
  filed. Cooper will emit that format as C data once it exists; inventing a
  Cooper-only struct would break on every SDK evolution.
- **Verified:** editor renders the animation controls + preview canvas
  (nonce-gated script), 326 Node + 10 integration.

### D-060 — Audition: hear the game (G10 v1, 2026-07-07)
- **Decision:** `Cooper: Hear the Game…` — run the built ROM in a transient
  luna, drain the SPC's native 32 kHz stereo output per frame
  (`drain_audio {max} → interleaved i16`), encode a RIFF/WAVE PCM16 (pure
  `wav.ts`), play it in a webview (`media-src data:`) and save the `.wav`
  under globalStorage. A silence probe (`nonSilentRatio`) tells the user when
  the capture is silent rather than leaving them doubting their speakers.
  Zero upstream needs — exactly the roadmap's "v1 can jump the queue" slice.
  G10 v2 (tracker round-trip) and v3 (per-entry SFX audition → the
  soundbank-player example ask) remain per the roadmap.
- **Verified:** pure WAV header/clamping tests + the real `snesmod_music`
  example: 2 s drained (>60k samples), **>10 % non-silent**, encodes to a
  playable wav.

### D-062 — Import luna-gui recordings (luna#83 dividend, 2026-07-07)
- **Context:** luna **v1.8.0** shipped input recording (#83, PR #86 — tested
  Cooper-side before merge): the GUI's "record input" writes
  `~/.local/luna/recordings/<rom>_NNN.input` — a `#`-commented header + the
  Player-1 `frame:mask` script (P2 written commented-out, not
  `--input`-replayable). The MCP surface is `start_input_capture` /
  `take_input_capture` (+ `input_capture_to_script`).
- **Decision:** `Cooper: Import Recording…` **auto-discovers** the newest
  `.input` under `~/.local/luna/recordings/` (else a file picker), parses it
  with the pure `parseInputFile` (strips `#` lines — including the commented P2
  line — and joins the P1 checkpoints), then offers **Replay now** (existing
  `cooperReplay`) or **Save as a gameplay test** (existing capture path). This
  closes the loop: play in luna-gui → record → import → replay/test.
- **No new luna dependency in Cooper's runtime:** import is pure text + the
  existing replay, so it works against any luna ≥ 1.7. Recording itself happens
  in luna-gui (v1.8.0). CI bumped to **OpenSNES v0.29.0** (anim module, the
  user-project test harness, the DW/DL fix — all verified before that PR).
- **Verified:** a real luna-gui-format `.input` file (comment header + P1 line
  + commented P2) parses to exactly its P1 checkpoints and round-trips to the
  canonical CLI form; comments-only → empty. The live record→export→replay
  determinism was proven against the v1.8.0 binary during PR testing.

### D-061 — Gameplay regression tests v1 (G9, 2026-07-07)
- **Decision:** `Cooper: Record Gameplay Test…` captures {input script,
  settle frames, framebuffer baseline PNG} into the project's
  **`.cooper-tests/`**; `Run Gameplay Tests` replays each from power-on in a
  transient luna and compares **byte equality** — a cycle-accurate emulator +
  power-on replay is deterministic, so no fuzzy diffing. Failures show
  expected-vs-actual side by side. Format is Cooper-side ON PURPOSE: the
  committed, CI-runnable `make test` format belongs to the SDK — **issue
  k0b3n4irb/opensnes#98** filed (same ownership logic as #97); Cooper migrates
  when it lands. Core is pure `gameplayTest.ts` (`replayAndCapture`/
  `runGameplayTest` over an `McpLike`), so the whole loop is Node-tested
  against the real binary.
- **Verified:** baseline recorded on aim_target (`10:Right, 200:0`), re-run →
  byte-identical PASS, tampered baseline → FAIL, results view renders
  expected/actual.

---

### Known limitations (Component #1)
- Standalone accumulator register `A` (e.g. `asl a`) is not scoped, to avoid
  false-positives on identifiers named `a`. Indexed `,x`/`,y`/`,s`/`,b` are.
- No semantic highlighting (TextMate only) — fine for v1; semantic tokens would
  need an LSP, a later component.
