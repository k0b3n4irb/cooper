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

### Known limitations (Component #1)
- Standalone accumulator register `A` (e.g. `asl a`) is not scoped, to avoid
  false-positives on identifiers named `a`. Indexed `,x`/`,y`/`,s`/`,b` are.
- No semantic highlighting (TextMate only) — fine for v1; semantic tokens would
  need an LSP, a later component.
