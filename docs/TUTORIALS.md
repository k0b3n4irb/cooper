# Cooper — Tutorials

Short, task-oriented walkthroughs. Each one is a real thing you'll want to do
while making an SNES game, start to finish. They assume Cooper is installed and
pointed at your OpenSNES SDK + luna (one-time setup: [User Guide §1–2](USER_GUIDE.md)).

| # | You want to… | Uses |
|---|---|---|
| [1](#1-from-zero-to-a-game-on-screen) | get a game running from nothing | New Project · Build · Run · Play |
| [2](#2-draw-a-sprite-and-make-it-walk) | draw a sprite and animate it | Palette/Tile editors · Metasprite export |
| [3](#3-find-and-fix-a-crash) | find why the game crashes | Breakpoints · Locals · Stepping |
| [4](#4-why-did-this-variable-change) | catch what corrupts a variable | Data breakpoint · Memory trace |
| [5](#5-my-game-drops-frames) | find the slow code | Frame profiler |
| [6](#6-turn-a-bug-into-a-test-that-never-comes-back) | lock a fixed bug with a test | Record · Gameplay tests |
| [7](#7-ship-your-game-to-a-real-snes) | run it on hardware | Validate · Deploy |
| [8](#8-let-your-ai-pair-on-opensnes) | make your AI OpenSNES-fluent | Configure AI |

---

## 1. From zero to a game on screen

**Goal:** go from an empty folder to your game running in a window.

1. **Command Palette → `Cooper: New Project…`** (or click **✨ New Project** on
   the dashboard). Pick a starting point — `text/hello_world` for the minimal
   one, or a full game like `games/breakout` — then a name and a folder.
2. Cooper copies that SDK example out of the SDK tree, wires its Makefile to
   your setup, sets up C IntelliSense, and **runs the first build**. Click
   **Open Project**.
3. Click **▶ Run** (sidebar or dashboard) — a rendered frame appears inline.
4. Click **🎮 Play** — the game opens in a **native window** at 60 fps with
   sound; grab your keyboard/gamepad and play.

**You now have:** a buildable, runnable, playable project that lives in its own
folder. Edit `main.c` and press Run again — or turn on **`Cooper: Toggle Watch`**
so every save rebuilds and refreshes the preview automatically.

---

## 2. Draw a sprite and make it walk

**Goal:** author a sprite's colours and pixels, then get correct C data for it.

1. **Palette** — right-click your sprite's indexed `.png` → **Edit Palette
   (SNES BGR555)**. Each R/G/B channel is 0–31 (real hardware gamut); rows of 16
   are the sub-palettes; entry 0 is transparent. Drag the sliders — the image
   recolours live — then **Save to PNG**.
2. **Pixels** — right-click the same `.png` → **Edit Tiles / Sprites**. Paint on
   the zoomable grid (grey lines = 8×8 tiles, blue = the sprite cell). Draw the
   frames of a walk cycle side by side.
3. **Preview the animation** — in the tile editor, set *from cell*, *frames* and
   *fps*, press ▶: the consecutive cells loop **while you keep painting**, so you
   tune the motion in place.
4. **Get the C** — right-click the `.png` → **Export Metasprite / Animation
   (C)…**. Choose the sub-sprite size (e.g. 32) and the grid (e.g. `2x2` for a
   64×64 character), then optional animation frames. Cooper opens a generated
   file with a `MetaspriteItem[]` table — with the **correct 8×8 OAM tile names
   computed from your sheet** — and a `DECLARE_ANIM_CLIP`.
5. Use it in your loop: `oamDrawMeta(0, x, y, hero_frame0, baseTile, 0,
   OBJ_LARGE);` and `animPlay(&p, &hero_anim); tile = animTick(&p);`. **Build**;
   your PNG edits regenerate the `.pic`/`.pal` automatically.

**You now have:** hardware-correct art and the exact C data the OpenSNES library
consumes — no hand-counting tile numbers.

---

## 3. Find and fix a crash

**Goal:** stop at your code, see the state, step through the bug.

1. Open `main.c`. Above each of your functions Cooper shows **`◉ break · ▶ debug
   here`** — click **▶ debug here** on the suspect function (say
   `enemies_update`). Cooper builds a debug (`-g`) ROM and launches luna paused.
2. Press **Continue (F5)** — execution stops **on your C line**, highlighted.
3. Open **Run and Debug** (`Ctrl/Cmd+Shift+D`):
   - **CALL STACK** shows where you are (`enemies_update @ main.c:142`). Click
     the frame.
   - **VARIABLES → Locals** — your C variables, typed (`u16`, `s16`, pointer);
     **structs and arrays expand** to named fields / `[0]`, `[1]`…
   - **VARIABLES → Registers** — `A/X/Y/PC/SP/P` (flags decoded `nvmxdizc`).
4. **Step** with F10 / F11 / Shift+F11 — one **C source line** at a time (over,
   into, out), watching a local go wrong.
5. Stuck at a weird spot? **Cooper: Show Disassembly** shows the 65816 at the PC,
   annotated with your symbols.

**You now have:** the exact line, the exact values, and a way to walk the bug —
not `printf` archaeology.

---

## 4. Why did this variable change?

**Goal:** catch the code that writes a variable it shouldn't.

**The fast way — memory trace:** at a debug stop (or standalone), run **`Cooper:
Trace Memory Accesses (one frame)…`** and give it the symbol (`player_hp`) or
address (`$7E0030`). Cooper records **every read/write to that address over the
next frame** and shows a table: each access with its **value, PC, and the
function that did it**, plus the scanline. The rogue writer is right there by
name.

**The classic way — data breakpoint:** while paused, open **WATCH**, add the
symbol/address, right-click → **Break on Value Change**. Continue — luna stops
**at the instruction that writes it**; the call stack names the culprit.

> The watch is bank-exact: use the bank your code executes from (`$7E:` WRAM, or
> the `$00`/`$80` low-RAM mirror).

**You now have:** the writer of a corrupted value, without reading every
assignment by hand.

---

## 5. My game drops frames

**Goal:** find where the CPU time goes and whether you fit the frame budget.

1. At a debug stop, run **`Cooper: Profile One Frame (CPU)`**.
2. Cooper traces **every instruction of the next frame** and shows:
   - a **per-function table** — master clocks, instruction count, and % of the
     frame, sorted by cost, attributed to **your** symbols;
   - a **per-scanline strip** — darker = busier, so you see *when* in the frame
     the work happens (is your logic spilling out of VBlank?).
3. Fix the top offender, rebuild, profile again — watch the bar shrink.

**You now have:** a real profiler for SNES homebrew (no one else has this) —
data instead of guesses about what's slow.

---

## 6. Turn a bug into a test that never comes back

**Goal:** reproduce a gameplay bug deterministically and keep it fixed forever.

1. **Capture it by playing** — click **🎮 Play**, and in luna-gui toggle **record
   input**. Play until the bug happens, then stop. luna-gui writes a `.input`
   recording.
2. **Import it** — **`Cooper: Import Recording…`** picks up the newest recording.
   Choose **Save as a gameplay test**, give it a name, and (recommended) an
   assertion — a symbol's expected value, e.g. `player_hp = 0300`.
3. Cooper writes a `[tests.<name>]` block into **`test/manifest.toml`** and
   captures the baseline. **Commit `test/` with your game.**
4. **Run them anytime** — **`Cooper: Run Gameplay Tests`** (or `make test` in a
   terminal / your CI). Deterministic replay from power-on: if a refactor breaks
   the behaviour, the test fails with the diverging value.

> No recording? You can also type the script directly with **`Cooper: Record
> Gameplay Test…`** (`10:Right, 200:0`).

**You now have:** committed, CI-runnable regression tests for actual gameplay —
the same `make test` runs in the editor and on your build server.

---

## 7. Ship your game to a real SNES

**Goal:** put your ROM on a flashcart and boot it on hardware.

1. **`Cooper: Validate ROM`** — Cooper checks the internal cartridge header the
   way the console does: title, checksum + complement (recomputed from the
   image), ROM size, reset vector, and the 512-byte copier header flashcarts
   dislike. A green report means it's ready.
2. **`Cooper: Deploy ROM`** — validates, then copies the `.sfc` to
   `cooper.deployPath` (your flashcart's SD card mount — asked once, then
   remembered).
3. Eject the card, put it in your SD2SNES / FXPak, and boot your game on real
   hardware.

**You now have:** a verified ROM on a cartridge — the homebrew finish line.

---

## 8. Let your AI pair on OpenSNES

**Goal:** make Copilot / Claude Code / Cursor actually good at OpenSNES.

1. Run **`Cooper: Configure AI (OpenSNES context)`**. It writes an **`AGENTS.md`**
   with the SNES/OpenSNES rules (the `int`=2 gotcha, BGR555 colour, sprite and
   tilemap limits, the build/run/luna workflow) and **registers luna + the
   OpenSNES SDK as MCP servers**.
2. Reload the window (or start your assistant's agent mode).
3. Now your AI can **look up the real API** from your installed SDK (exact
   signatures, symbol search, hardware constraints) instead of guessing, and
   **drive luna** to peek VRAM/memory, read state and screenshot — so it can
   **verify its own code on cycle-accurate hardware**, not just claim it works.

**You now have:** an assistant that writes correct OpenSNES C and checks itself
in the emulator — the payoff of owning the whole vertical.

---

*Reference for every command, setting and gotcha: the [User Guide](USER_GUIDE.md).*
