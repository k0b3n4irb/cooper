# Cooper — User Guide

Cooper is a VS Code extension that turns VS Code into an **IDE for making SNES
games** with the OpenSNES SDK and the luna emulator: C support, one-click build,
play, a source-level **debugger**, asset editors, tests, and shipping.

> This is the **reference** — every command, setting and gotcha. Learning by
> doing? Start with the **[Tutorials](TUTORIALS.md)** (use-case walkthroughs).
>
> Status: tracks the shipped extension (v0.45.x). Sections marked **(coming)**
> are not implemented yet.

---

## 1. Prerequisites

Cooper orchestrates tools it does **not** bundle — install them once:

| Tool | What it is | How Cooper finds it |
|---|---|---|
| **OpenSNES SDK** | the libraries + `make` rules + `cc65816` compiler | setting `cooper.opensnesPath`, else the project Makefile, else a parent search |
| **luna** | the SNES emulator (run / preview / debug backend) | setting `cooper.lunaPath`, else the SDK's bundled binary, else `luna` on your PATH |
| **clangd** | the C language server (completion, hover, go-to-definition) | the bundled *clangd* VS Code extension downloads it in one click |

### Where to get them — download, don't compile

No compiler to install: **download the prebuilt SDK and emulator for your
architecture and unzip them.** You only need `make` and a text editor.

- **OpenSNES SDK** — grab the release for your platform from
  <https://github.com/k0b3n4irb/opensnes/releases> and extract it somewhere
  permanent (e.g. `~/opensnes`):

  | Platform | Asset |
  |---|---|
  | Linux x86_64 | `opensnes_<version>_linux_x86_64.zip` |
  | Linux aarch64 (arm64) | `opensnes_<version>_linux_arm64.zip` |
  | macOS arm64 | `opensnes_<version>_darwin_arm64.zip` |
  | Windows x86_64 | `opensnes_<version>_windows_x86_64.zip` |

  It ships its own cross-compiler + tools (`cc65816`, `qbe`, `wla-65816`,
  `gfx4snes`…) in `bin/` — nothing else to build. Point `cooper.opensnesPath` at
  that folder. You just need `make` (macOS: `xcode-select --install`; Ubuntu/Debian:
  `sudo apt install make`; Fedora: `sudo dnf install make`; Windows: MSYS2 +
  `pacman -S make`).
- **luna** — download the prebuilt binary for your OS from
  <https://github.com/k0b3n4irb/luna/releases/latest>, unzip, and point
  `cooper.lunaPath` at the `luna` binary **or** the folder it unzips into.
- **clangd** — you do **not** install this yourself: the bundled *clangd*
  extension downloads the language server in one click (see §9). (clangd is
  standalone — no separate `clang` needed for IntelliSense.)

> **Source-level C debugging** (highlight your `main.c` line, typed locals, struct
> expansion — §7) needs an OpenSNES **release** that includes Cooper debug info
> (`cc65816` emitting `@cline`/`@dbglocal`). Older releases still work — the
> debugger just falls back to the symbol/register level.

**Key idea — your project is separate from the SDK.** Your game lives in *its own
folder* (just your `.c`, assets, and a Makefile). OpenSNES and luna are installed
elsewhere as *user releases*. Point Cooper at them once:

```jsonc
// .vscode/settings.json  (or your global VS Code settings)
{
  "cooper.opensnesPath": "/path/to/opensnes",
  "cooper.lunaPath": "/path/to/luna"   // the binary OR the folder containing it
}
```

> `cooper.lunaPath` accepts either the `luna` binary or the folder it unzips into
> (which also contains `luna-gui`). If you leave it empty, Cooper looks for the
> SDK's bundled binary, then `luna` on your PATH.

---

> **In a hurry?** After installing, run **Cooper: Get Started** (or click the 🎓 in
> the Cooper panel header) for an interactive, in-editor walkthrough that does
> everything below, step by step.

## 2. Install Cooper

Download the latest `cooper-x.y.z.vsix` from
<https://github.com/k0b3n4irb/cooper/releases/latest> and install it
(`code --install-extension cooper-x.y.z.vsix`, or in VS Code: Extensions →
`…` menu → *Install from VSIX…*). Marketplace **(coming)**. Cooper bundles the
**clangd** extension; when it prompts
*"clangd is not installed"*, click **Install** (or run `clangd: Download language
server`) — one click, no terminal.

---

### Start a new game — `Cooper: Create New Game…`

The guided way in (also the 🎮 button on the empty dashboard): pick a **game
type** (platformer, RPG, shmup, fighting, racing, puzzle, adventure — or
*custom*). Cooper prefills a sensible SNES profile (BG mode, sprite sizes, the
right library modules, sound on), lets you tweak the **hardware features** with
checkboxes (SRAM save, SA-1, SuperFX, HiROM, FastROM), then generates the
project — Makefile, a starter `main.c` for that mode, `.cooper/graphics.json` —
builds it, and opens it. You're one **Run** away from a booting game.

### Or start from an SDK example — `Cooper: New Project…`

No project yet? Don't copy files around: run **Cooper: New Project…** (also
offered on the dashboard when no project is open). Pick a **real SDK example**
as the starting point (`text/hello_world` is the recommended minimal one — or
start straight from a game like `games/breakout`), a name, and a folder. Cooper
copies the example **out of the SDK tree**, wires its Makefile to your SDK
(plain `make` works in a terminal too), configures C IntelliSense, **runs the
first build**, and opens the project — ready for **Run** (§6) and **Debug** (§7).

## 3. The Cooper sidebar

Click the **Cooper** icon (a gamepad) in the activity bar. Everything is one click —
no commands to memorize.

![The Cooper sidebar](images/sidebar.png)

- **PROJECT** — your ROM (with a *built* badge) and the detected SDK.
- **BUILD & RUN** — Build, Run / Preview, Debug.
- **PPU VIEWERS** — Palette, Sprites, Tiles (from a Run, or live at a debug stop).
- **SYMBOLS** — *your* functions (parsed from your `.c` and matched to the `.sym`).
  **Click one to toggle a breakpoint on it.**

The **🏠** and **↻** buttons in the panel header open the dashboard and refresh.

## 4. The dashboard ("Home")

Click **🏠** for a graphical home: big Build / Run / Debug buttons, a live preview
thumbnail, and PPU viewer cards.

![The Cooper dashboard](images/dashboard.png)

---

## 5. Build

Click **Build** (sidebar or dashboard). Cooper runs `make` **in your project
folder** and passes `OPENSNES=<your SDK>`, so the build works even though your
project lives outside the SDK tree. Compiler errors appear in the **Problems**
panel (click to jump to the line).

> **Build and Run/Preview are release builds** (optimised) — the ROM you preview
> is byte-identical to the one you ship. Debugging uses a separate debug build
> (see §7); you don't manage that yourself.

> If you see `…/make/common.mk: No such file or directory`, set `cooper.opensnesPath`
> to your OpenSNES release.

## 6. Run / Preview / Play

Click **Run**. Cooper renders a frame in luna and shows it inline.

Click **🎮 Play** (sidebar, dashboard, or `Cooper: Play (luna-gui)`) to launch
your game in **luna-gui** — a real native window at 60 fps with audio and your
gamepad/keyboard, plus luna's own interactive debugger (breakpoints, F10/F11
stepping, event viewer). The window lives on its own: closing VS Code doesn't
kill your game. luna-gui ships in the luna release zip next to the `luna`
binary — point `cooper.lunaPath` at that folder.

![A rendered frame](images/preview.png)

Tune it with `cooper.preview.steps` (how long to run before the screenshot) and
`cooper.preview.forceDisplay` (show VRAM even if the screen is still blanked).

### Gameplay regression tests

Record a bug repro once, keep it green forever — as **committed** tests that
also run in your CI (`make test`, OpenSNES ≥ 0.29):

1. **Cooper: Record Gameplay Test…** — a name, an optional input script
   (`10:Right, 200:0`; empty = a visual boot test), and for input tests the
   **assertions** that are the oracle (`target_x = F700` — a symbol's expected
   little-endian bytes). Cooper writes a `[tests.<name>]` block into
   **`test/manifest.toml`**, captures the baseline, and opens the manifest.
2. **Cooper: Run Gameplay Tests** — runs `make test` and shows the pass/fail.
   Commit `test/` with your game: the exact same tests run in CI.

### Hear your game

**Cooper: Hear the Game…** renders the first seconds of your ROM's **audio**
(the SPC's real 32 kHz output) headlessly and plays it back in the editor —
music and SFX without launching anything. The capture is also saved as a
`.wav`. If it comes back silent, Cooper says so (does your game start its
music at power-on?).

### Watch mode — see every save

**Cooper: Toggle Watch** (an 👁 appears in the status bar): every time you save
a source (`.c`, `.asm`, a `res/` PNG, a `.it` track…), Cooper quietly rebuilds
and refreshes the dashboard preview — the edit→see loop with zero clicks.
Build failures turn the status-bar item red (details in **Cooper: Show Log**).
Click the 👁 (or run the command again) to stop.

---

## 7. Debug

The jewel. Workflow:

1. **Set a breakpoint** — in the sidebar under **SYMBOLS**, click a function (e.g.
   `enemies_update`). It appears under **BREAKPOINTS** in the Run-and-Debug view.
   Click the symbol again to remove it. Or straight **in the editor**: every
   function that made it into the ROM shows **`◉ break · ▶ debug here`** above
   its definition — one click to break there, one to start debugging there.
   (Disable with the `cooper.codeLens` setting.)
2. **Start** — click **Debug** (sidebar) or press **F5**. Cooper **builds a debug
   (`-g`) ROM automatically** (you don't need to Build first), then luna launches
   and pauses at the program's entry.
3. **Run to your code** — press **Continue** (F5). It stops at your breakpoint.
4. **Inspect** — open **Run and Debug** (`Ctrl/Cmd+Shift+D`):
   - **CALL STACK** shows the stop (e.g. `enemies_update @ 00:84AB`). **Click the
     frame** to populate the variables.
   - **VARIABLES → Locals**: the current function's C variables (`pad`, `dx`,
     `cfg`…), read live from the stack frame and typed (`u16`, `s16`, pointer,
     `struct`). **Structs and arrays expand** — click to see named fields or
     elements (`[0]`, `[1]`…), nested, each typed. *(Source-level `-g` builds —
     which Cooper makes by default.)*
   - **VARIABLES → Registers**: `PC, A, X, Y, SP, DP, DB, PB, P` (status flags
     decoded as `nvmxdizc`), `E`.
   - **WATCH**: type a symbol or address (`frame_count`, `$7E0030`) to read it.
   - **Data breakpoint**: in WATCH, right-click → *Break on Value Change* → stops
     at the instruction that writes that address.
5. **Snapshots** — at any stop, **Cooper: Save Debug Snapshot** captures the whole
   machine (CPU, memory, PPU…). **Cooper: Restore Debug Snapshot…** jumps back to
   it — reproduce a bug as many times as you need without replaying the game.
   (A snapshot only loads against the same ROM build.)
   **Disassembly** — **Cooper: Show Disassembly** opens the 65816 instructions at
   the stop, disassembled by luna itself and annotated with your symbols
   (`main`, `enemies_update+0x12`…), the current PC highlighted.
   **Profile a frame** — **Cooper: Profile One Frame (CPU)**: traces every
   instruction of the next frame and shows **which functions burn your master
   clocks** (table with mclk/instructions/%) plus a per-scanline strip — is
   your game logic fitting the frame budget, and when in the frame does it run?
   **Replay inputs** — **Cooper: Replay Inputs…**: give it `frame:buttons`
   checkpoints (`120:Start, 300:A+Right, 360:0` — a checkpoint holds until the
   next one) and Cooper replays them **deterministically from power-on**, then
   pauses the debugger at the end. Reproduce a gameplay bug forever with the
   same inputs; the canonical script also works with `luna run --input`.
   **Record a repro** — hit **Play** (luna-gui), toggle its *record input*, play
   until the bug, stop. Then **Cooper: Import Recording…** picks up the newest
   `.input` file and lets you **replay it** or **save it as a gameplay test** —
   the whole "reproduce this bug" loop without typing a script.
   **Who writes this address?** — **Cooper: Trace Memory Accesses (one frame)…**:
   give it a symbol or address (`frame_count`, `$7E0030`) and it records every
   read/write to it over the next frame, each attributed to the function that did
   it (kind, value, PC, scanline). Note: the watch is bank-exact — use the bank
   your code actually executes from.
6. **See the PPU at the stop** — sidebar → **PPU VIEWERS**:

| Palette (CGRAM) | Sprites (OAM) | Tiles (VRAM) |
|---|---|---|
| 16×16 colour grid | the 128-sprite table | the decoded tile sheet |

The **Tiles** viewer is interactive: pick the **bpp** (2/4/8), the 16 KB
**window** into the 64 KB VRAM, and the **sub-palette** (groups of 4/16/256
colours, exactly like the hardware). Changes are instant (rendered from the
last snapshot); **↻ Re-read VRAM** re-reads the machine.

**Memory Map** (sidebar → PPU VIEWERS, or `Cooper: Show Memory Map`) answers
"where did my memory go?": your **WRAM** blocks with the linker's exact sizes
(`.oam_buffer` 544 B, `.bss` 2 KB…, mirror aliases merged, your variables
listed inside each block) and a **VRAM heatmap** (1 KB per cell) showing what
the game actually uploaded. Works standalone or at a debug stop.

![VRAM tile sheet](images/vram.png)

### Source-level (C line) debugging

With a compiler built from the patched `cc65816`/QBE, Cooper debugs at the **C
source line**: set breakpoints **in the `main.c` gutter**, and when you stop, your
**C line is highlighted** and the call stack shows `main.c:line`. Cooper passes the
debug-info build flags automatically. If the compiler isn't patched, the debugger
gracefully falls back to the symbol/register level (the frame shows a symbol, no
highlighted line).

**Step Over / Into / Out** move by **C source line** (not one CPU instruction):
*Step Over* (F10) runs past calls; *Step Into* (F11) enters them; *Step Out*
(Shift+F11) runs until the current function returns.

---

## 8. Ship to real hardware

- **Cooper: Validate ROM** — checks the internal header the way the console
  does: title, checksum + complement (recomputed from the image), ROM size,
  reset vector, and the 512-byte copier header flashcarts dislike. Green
  report = ready to flash.
- **Cooper: Deploy ROM** — validates, then copies the `.sfc` to
  `cooper.deployPath` (your flashcart's SD card mount — asked once, then
  remembered). Eject, insert, play on the real thing.

## 9. C IntelliSense

Open a `.c` file in an OpenSNES project and Cooper **writes a `.clangd`
automatically** (it never overwrites an existing one). With clangd installed,
hover a `#define`, **F12** to jump to a definition, get completion — exactly what
the build's clang lint sees. Turn auto-config off with
`cooper.autoConfigureClangd: false`; reconfigure manually with **Cooper: Configure
clangd**.

> Caveat: clangd uses the host target where `int` = 4 bytes; on the SNES `int` = 2.
> Fixed-width types (`u8`/`u16`/…) are always correct; for sizes, the `cc65816`
> build is the authority.

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| **No C completion / "clangd not installed"** | Click **Install** on the clangd prompt (or `clangd: Download language server`). |
| **`…/make/common.mk: No such file`** on build | Set `cooper.opensnesPath` to your OpenSNES release. |
| **Run/Debug: "luna not found"** | Set `cooper.lunaPath` to the luna binary **or** its folder. |
| **Debug does nothing** | Make sure the ROM is built (Build first). A stale `launch.json` `program` self-heals as of 0.12.1; you can also delete the `program` line entirely. |
| **"your OpenSNES release predates the Cooper debug info"** | Your SDK is < 0.26: debugging works but at the symbol level (no `main.c` lines, no typed locals). Download the latest release — the warning's button takes you there. |
| **VARIABLES is empty while paused** | Click the frame in **CALL STACK** to select it; expand **Registers**. |
| **`#include <snes.h>` shows errors** | Run **Cooper: Configure clangd**, then restart the clangd server. |
| **Something silently does nothing** | Run **Cooper: Show Log** (or View → Output → *Cooper*): every build, luna run, MCP call, timeout and error is logged there. Include it when reporting a bug. |

---

## 11. Asset editors

### Graphics mode — the SNES constraints, chosen once

Run **Cooper: Set Graphics Mode…** to pick your game's **BG mode** (each shown
with what it gives you — *Mode 1 = two rich layers + a text layer*, *Mode 7 =
one rotating layer*…) and the **sprite sizes** (an OBSEL pair like 16/32). From
that, Cooper knows exactly what's legal: how many background layers, how many
colours per palette, which sprite sizes — and the asset editors enforce it so
you can't paint an impossible image.

Cooper reads a sensible default straight from your code's `setMode(...)` /
`oamInit(...)` calls; the picker saves an explicit override to
`.cooper/graphics.json` (commit it with your project).

### Palette

**Right-click an indexed `.png`** in the Explorer → **Edit Palette (SNES BGR555)**
(or run **Cooper: Edit Palette**). You get a hardware-accurate palette editor:

- Colours are **BGR555** — each of R/G/B is **0–31** (the real 15-bit SNES gamut,
  32768 colours), edited with sliders that snap to the hardware grid.
- Swatches are laid out in **rows of 16 = the sub-palettes**; **entry 0 is
  transparent**. (CGRAM is 0–127 for backgrounds, 128–255 for sprites.)
- A **live preview** of the actual image recolours as you drag the sliders, and a
  **sub-palette size** selector (4 / 16 / 256 = 2bpp / 4bpp / 8bpp) matches the grid
  to your target depth.
- **Save to PNG** writes the palette back into the image. Because Cooper edits the
  *source* PNG (the file `gfx4snes` reads), your next **Build** regenerates the
  `.pal` automatically — no separate palette file to manage.

> Tip: at a debug stop, open **PPU VIEWERS → Palette** to see the **live CGRAM** on
> real hardware and compare it with what you designed.

### Tiles / sprites

**Right-click a `.png` → Edit Tiles / Sprites** (or **Cooper: Edit Tiles /
Sprites**). A zoomable paint grid over the indexed image:

- Pick a colour from the palette strip and **paint pixels** (click/drag).
- Grey lines mark the **8×8 tiles**; blue lines mark the **sprite cell** (choose
  8 / 16 / 32 / 64 — the SNES square sizes). Index 0 is transparent.
- **Animation preview**: pick a starting cell, a frame count and an fps, press
  ▶ — consecutive sprite cells play as a loop, **live while you paint** (draw
  frame 2 of the walk cycle and watch it move).
- **Save to PNG** writes the pixels back; **Build** regenerates the `.pic`.

### Add a sprite (art → on screen)

**Right-click a sprite `.png` → Add Sprite…** does the tedious wiring for you:
it converts the PNG (gfx4snes), generates the `data.asm` bridge that pulls the
tiles/palette into the ROM, adds the Makefile rule — and hands you the C to
load and place it (on your clipboard and in a tab), with the tile number
already worked out. Paste the `extern`s at the top and the load call in
`main()`, **Build**, and your sprite is on screen. (Cooper checks the sprite
size against your graphics mode's sprite sizes and warns if it doesn't fit.)

### Metasprites & animation

**Right-click a sprite `.png` → Export Metasprite / Animation (C)…** builds a
`MetaspriteItem[]` table for a multi-cell sprite (e.g. a 64×64 hero from a 2×2
grid of 32×32 sub-sprites) with the **correct 8×8 OAM tile names computed from
your sheet** — the thing the library asks the editor to get right (gfx4snes
`-T` gets block indices wrong for 16/32px blocks). Add animation frames and
Cooper also emits a `DECLARE_ANIM_CLIP` you drive with `animPlay`/`animTick`.
The generated C opens in a new editor, ready to paste (or `#include`).

### Tilemaps

**Right-click a `.map` → View Tilemap (assembled)** to see the background the way
the SNES draws it — Cooper reads the `.map` + `.pic` tileset + `.pal` and applies
the real per-cell attributes (**sub-palette**, **H/V flip**). This is a *viewer*:
for **authoring** tilemaps, use **Tiled** (`.tmj`) — the SDK converts it with
`tmx2snes` in the build.

## 12. Make your AI OpenSNES-aware

Run **Cooper: Configure AI (OpenSNES context)**. It:

- writes an **`AGENTS.md`** (+ `.github/copilot-instructions.md`) with the
  SNES/OpenSNES rules — the `int`=2 gotcha, colour/sprite/tilemap hardware limits,
  the build/run/luna workflow — so any assistant (Copilot, Claude Code, Cursor…)
  writes correct OpenSNES C; and
- **registers luna as an MCP server** (`.vscode/mcp.json` + `.mcp.json`) so the AI
  can *drive the emulator* — peek VRAM/memory, read state, screenshot — and
  **verify its own changes on real hardware**, not by guessing.

Cooper also ships an **OpenSNES MCP server**: your assistant can query the
*installed SDK* directly — exact function signatures (`lookup_api`), symbol search
(`search_api`), header list, and hardware constraints. So it writes correct
OpenSNES C, looks up the real API instead of guessing, and verifies in luna.

Reload the window (or start agent mode) so your assistant picks up the MCP servers.

## 13. What's next

The full workflow ships today — create/build/**play**, source-level debugger
(snapshots, disassembly, memory trace, profiler, replay), asset editors +
metasprite/anim export, gameplay tests on `make test`, audio audition, ROM
validation + flashcart deploy, and an OpenSNES-aware AI.

On the horizon: a **visual metasprite composer** for non-rectangular layouts,
audio **tracker round-trip** + per-entry SFX audition, **usb2snes** over-the-wire
deploy (FXPak), luna-gui **live reload** in watch mode, and Marketplace/OpenVSX
publishing.

See `docs/DECISIONS.md` (dated decision log) and `.claude/notes/roadmap.md` for
the full plan.
