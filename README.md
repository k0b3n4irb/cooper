# Cooper — the OpenSNES IDE

> Make SNES games without seams. Cooper turns VS Code into a full IDE for the
> **OpenSNES** SDK + the **luna** cycle-accurate emulator: create, edit, build,
> **play**, debug at the C-source level, author art, test, and ship — all in one
> place.

Cooper is a VS Code extension. It's not a bag of loosely-wired tools: one author
owns the whole vertical (the SDK, the `cc65816` compiler, and luna), so Cooper is
**co-designed** with them — the debugger reads compiler-emitted debug info, the
tests run in the same emulator the SDK ships, and your AI can query the real API.

**New here?**
- **[Tutorials](docs/TUTORIALS.md)** — short use-case walkthroughs (from zero to
  a running game, draw & animate a sprite, debug a crash, profile a slow frame,
  turn a bug into a test, ship to hardware).
- **[User Guide](docs/USER_GUIDE.md)** — the full reference: install, every
  command, settings, troubleshooting.

## What you can do with it

- **Start & build** — scaffold a project from a real SDK example (`New Project`),
  one-click **Build**, and a **watch mode** that rebuilds + refreshes on every
  save.
- **Run & play** — render a frame inline, or **Play** your game in a native
  luna-gui window (60 fps, sound, gamepad).
- **Debug at the C source level** — breakpoints in your `main.c` (gutter or a
  `◉ break · ▶ debug here` CodeLens), **typed locals** with struct/array
  expansion, C-line stepping, registers, data watchpoints, **snapshots**,
  symbol-annotated **disassembly**, a **"who wrote this address?" memory trace**,
  and a **frame profiler** (per-function cycles + a per-scanline strip).
- **See the hardware** — live **PPU viewers** (CGRAM palette, OAM sprites, an
  interactive VRAM tile browser) and a **WRAM/VRAM memory map**.
- **Author assets** — hardware-exact **palette** and **tile/sprite** editors
  (with animation preview), a **tilemap viewer**, and **metasprite + animation C
  export** with correct OAM tile-name computation.
- **Test & reproduce** — **record** a play session (or import one from luna-gui),
  **replay** it deterministically, and save it as a committed, CI-runnable
  **gameplay regression test** (`make test`).
- **Hear it & ship it** — render the game's **audio** to a `.wav` you play in the
  editor; **validate** the ROM header/checksum and **deploy** to a flashcart SD.
- **AI, OpenSNES-aware** — one command makes Copilot / Claude Code / Cursor query
  the real SDK API and **verify their code in luna**.

## Install

Cooper orchestrates tools it doesn't bundle — **download the prebuilt builds, no
compiler to install:**

1. **OpenSNES SDK** — the release for your OS/arch from
   [opensnes/releases](https://github.com/k0b3n4irb/opensnes/releases) (ships its
   own `cc65816`/`qbe`/`wla`/`gfx4snes`). You only need `make`.
2. **luna** — the emulator (+ `luna-gui`) from
   [luna/releases](https://github.com/k0b3n4irb/luna/releases/latest).
3. **Cooper** — the latest `.vsix` from
   [cooper/releases](https://github.com/k0b3n4irb/cooper/releases/latest):
   `code --install-extension cooper-x.y.z.vsix`.

Then point Cooper at the tools once (`cooper.opensnesPath`, `cooper.lunaPath`) and
run **`Cooper: New Project…`**. Full setup: [User Guide §1–2](docs/USER_GUIDE.md).
Not on the Marketplace yet — install from the `.vsix`.

## Design

The architecture and every dated decision live in [`docs/`](docs/):

- [`01-architecture.md`](docs/01-architecture.md) — the "ring": a shared contract
  (compiler debug-info + luna as the backend), everything else a thin client.
- [`02-debugger-dap-luna.md`](docs/02-debugger-dap-luna.md) — the DAP ↔ luna
  debugger.
- [`03-debug-info-format.md`](docs/03-debug-info-format.md) — the debug-info
  format (an extended WLA `.sym`).
- [`DECISIONS.md`](docs/DECISIONS.md) — the dated decision log (D-001…).

## License

MIT — see [LICENSE](LICENSE).
