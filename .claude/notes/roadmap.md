# Cooper — vision & roadmap

_The forward plan. "Now" lives in `status.md`; every dated decision in
`docs/DECISIONS.md`; the architecture in `docs/01-architecture.md`. Last
reshaped 2026-07-08 (the vision phase)._

## Positioning (the load-bearing decision)

**Cooper is the guided, SNES-aware, *code-first* IDE** — GB Studio's gentle
onramp *without ever hiding the code or capping the ceiling*. GB Studio / NesMaker
hide the code behind a VM and hit a wall; Cooper keeps real C + a real
source-level debugger, profiler and AI-verify from day one, and *adds* guardrails,
scaffolding and SNES-correct editors on top. The 90/10 ("guide the 90%, free the
10%") is served by **scaffolding + constraints + snippets**, never by replacing
code with visual scripting.

**Whitespace (confirmed 2026-07-08):** there is *no* guided/integrated SNES
game-making experience — the field is programmer-only (PVSnesLib/OpenSNES) +
CLI converters + Mesen-S *viewers*. Cooper's lane is open and distinct from GB
Studio (different console, opposite philosophy).

## The three pillars (the mental model)

| Pillar | Serves | Contents | State |
|---|---|---|---|
| **Onramp** — lower the barrier | the 90% | New Game wizard, genre presets, starters+snippets, the mode/constraint system, editors that make impossible states unrepresentable | in progress |
| **Workshop** — the daily craft | everyone | palette / tile / tilemap / metasprite+anim editors, build·run·**play**, watch mode — made SNES-perfect by the constraint model | partial (editors exist; going mode-aware) |
| **Pro Bench** — raise the ceiling | the 10% + all who grow | source-level debugger, profiler, memory tools, gameplay tests, ROM validate/deploy, AI-verify | **done (the moat)** |

**The graduation insight:** the Onramp flows *into* the Pro Bench inside one tool
— exactly what GB Studio can't offer. Cooper never makes you leave to grow.

## Go-to-fails to avoid (explicit)

1. **Becoming a no-code / visual-scripting engine.** Abandons the moat, breaks the
   garde-fou. The wizard/snippets lower the ramp; they never replace code.
2. **Cloning Aseprite / Tiled / a tracker.** Build only the *SNES-specific* layer
   (mode-constrained editors, BGR555 palette, metasprite export); heavy pixel-art
   / level design can round-trip an external tool via watch mode.
3. **Embedding drift-prone starter code/snippets.** Keep them minimal and
   **CI-compile every one against the current SDK** (the D-050 lesson).
4. **Big-bang work.** Thin, shippable, verified slices only.
5. **Config sprawl / hard-coding.** Catalogues stay editable **data**.

## Evolvability principles

- **Data-driven catalogues** shipped as files: `data/gameTypes.json` (done),
  future `data/starters/<type>/`, `data/snippets/<category>/`.
- **One source of truth**: `snesModes.ts` — every editor reads the same
  constraint model; add a rule once, everything enforces it.
- **Pure-logic-first + CI-grounded**: pure modules cross-checked against the
  *real* SDK headers/build; the load-bearing test is **building the output**.
- **Thin slices, tagged releases**; upstream gaps → issues on luna/OpenSNES
  (confirm the gap live first), never a silent workaround.

## Forward phases (partly parallel; the dogfood drives priority)

### Phase A — Guided creation (finish the New Game flow) — *now*
- ✅ A1 **project generator** (`projectGen.ts`): `config → Makefile + starter
  main.c`, verified by building all 8 game types.
- ✅ A2 **`Cooper: Create New Game…`** wizard: survey genre → prefilled profile →
  flag checkboxes → (custom: pick mode) → generate + `.cooper/graphics.json` +
  build + open.
- 🔜 A3 **starter + snippet library** (data-driven, CI-compiled): a richer base
  `main.c` per genre; graphics/sound/effects snippets with a small manifest
  (title, required modules, insertion point).

### Phase B — Mode-aware asset Workshop
- 🔜 B1 palette + tile editors **read the resolved config** and enforce/teach
  (sub-palette count, bpp lock, legal sprite sizes; `validateBgImage`/
  `validateSpriteImage`).
- 🔜 B2 **tilemap editor** (the big one) — mode-aware; supersedes D-042 (an
  editor, not just a Tiled viewer). Also resolves the old Q4.

### Phase C — Dogfood (parallel to B)
- Build a real small game using only the Cooper flow; every friction becomes the
  next Workshop priority. Produces a showcase + real screenshots.

### Phase D — Cohesion & reach
- UX cohesion pass (30+ commands → a coherent surface / unified home); real
  screenshots; then Marketplace / OpenVSX publishing (after dogfooding).

### Ongoing / opportunistic (unblocked, pulled by dogfood)
- Audio v2 (`.it` tracker round-trip) · visual metasprite composer
  (non-rectangular) · luna-gui live reload in watch mode (needs a luna issue) ·
  usb2snes deploy (needs hardware to verify).

## Done (0.0.1 → 0.46.0) — the compact history

- **Foundations & language (C1–C3):** WLA-DX highlighting, C support via clangd,
  frictionless `.clangd` onboarding, TS+esbuild+two-tier tests.
- **Build/run/play (C5, G1):** make task + problem matcher, luna preview, Play in
  luna-gui, watch mode.
- **Debugger (C4, the jewel):** source-level C (breakpoints in `main.c`, typed
  locals + struct expansion, C-line stepping), registers/memory, data
  watchpoints, snapshots, disassembly, memory trace, **frame profiler**, PPU
  viewers + memory map. Compiler debug-info co-designed (extended WLA `.sym`).
- **Assets (C6):** hardware-exact palette + tile editors, tilemap viewer,
  metasprite/anim C emitter; the **mode-driven constraint spine** (D-065) +
  game-type presets (D-066) now under way.
- **Game-environment road (G1–G10):** input replay + record import, gameplay
  tests on `make test`, ROM validate/deploy, audio audition.
- **AI (C7):** AGENTS.md context + luna MCP + OpenSNES MCP → write→build→run→
  verify-in-luna loop.
- **Infra:** GitHub CI (build + two-tier tests vs a real SDK build + pinned luna)
  + tag-triggered `.vsix` release. Three upstream issues (luna#83, opensnes#97/#98)
  filed, merged, released and consumed.

Detail for every slice: `docs/DECISIONS.md` (D-001…). Standing rules:
`.claude/rules/` (architecture garde-fou, workflow, commits).
