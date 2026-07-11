# Cooper — Tutorials

Short, task-oriented walkthroughs. Each one is a real thing you'll want to do
while making an SNES game, start to finish. They assume Cooper is installed and
pointed at your OpenSNES SDK + luna (one-time setup: [User Guide §1–2](USER_GUIDE.md)).

| # | You want to… | Uses |
|---|---|---|
| [1](#1-from-zero-to-a-game-on-screen) | get a game running from nothing | **New Game (guided)** · Build · Run · Play |
| [2](#2-create-a-sprite-and-make-it-walk) | create a sprite and animate it | New Sprite · Palette/Tile editors · Add Sprite |
| [3](#3-give-it-sound-and-collision) | add a sound effect and collision | Add Sound Effect · Add Snippet |
| [4](#4-find-and-fix-a-crash) | find why the game crashes | Breakpoints · Locals · Stepping |
| [5](#5-why-did-this-variable-change) | catch what corrupts a variable | Data breakpoint · Memory trace |
| [6](#6-my-game-drops-frames) | find the slow code | Frame profiler |
| [7](#7-turn-a-bug-into-a-test-that-never-comes-back) | lock a fixed bug with a test | Record · Gameplay tests |
| [8](#8-ship-your-game-to-a-real-snes) | run it on hardware | Validate · Deploy |
| [9](#9-let-your-ai-pair-on-opensnes) | make your AI OpenSNES-fluent | Configure AI |

---

## 1. From zero to a game on screen

**Goal:** go from an empty folder to a game you can already steer.

1. **Command Palette → `Cooper: New Game…`** (or click **🎮 New Game** on the dashboard — it's also the first step of the *Get Started with
   Cooper* walkthrough, Help → Welcome).
2. **Answer the survey:** what kind of game? (platformer, RPG, shmup, fighting,
   racing, puzzle, adventure — or *custom* if you want to pick everything
   yourself). Cooper prefills the right SNES profile: graphics mode, sprite
   sizes, library modules.
3. **Tick the hardware you want** — sound (on by default), battery save (SRAM),
   FastROM, HiROM, SA-1, SuperFX. This decides the Makefile flags for you.
4. Pick a name + folder. Cooper **generates the project** (Makefile, starter
   `main.c`, `.cooper/graphics.json`, C IntelliSense) and **runs the first
   build**. Click **Open Project**.
5. Click **▶ Run** — and *you're already playing*: the starter shows a character
   on a genre-coloured backdrop that **moves with the D-pad** (4-way for
   top-down games, left-right for side-scrollers). No black screen.
6. Click **🎮 Play** — the game opens in a **native window** at 60 fps with
   sound; grab your keyboard/gamepad.

**You now have:** a buildable, runnable, steerable game. Edit `main.c` and press
Run again — or turn on **`Cooper: Toggle Watch`** so every save rebuilds and
refreshes the preview automatically.

> Prefer starting from a **real SDK example** (breakout, hello_world…)? Use
> **`Cooper: New Project…`** (**✨** on the dashboard) — Cooper copies it out of
> the SDK tree and wires it up the same way.

---

## 2. Create a sprite and make it walk

**Goal:** create art from scratch, draw it, and get it moving in the game.

1. **Create the canvas** — **`Cooper: New Sprite (draw one)…`**. Pick a
   size (8/16/32/64 px — Cooper defaults to your graphics mode's sprite size) and
   a name. You get a fresh blank canvas in `res/`, with a ready 16-colour
   palette, opened straight in the paint editor. (Starting from existing art
   instead? Right-click any indexed `.png` → **Edit Tiles**.)
2. **Draw** — paint on the zoomable grid (grey lines = 8×8 tiles, blue = the
   sprite cell; index 0 is transparent). For an animation, make the canvas a
   strip and draw the walk frames side by side.
3. **Colours** — right-click the `.png` → **Edit Palette**. Each
   R/G/B channel is 0–31 (the real hardware gamut); the image recolours live.
4. **Preview the animation** — in the tile editor, set *from cell*, *frames* and
   *fps*, press ▶: the consecutive cells loop **while you keep painting**.
5. **Put it in the game** — right-click the `.png` → **Add Sprite…**. Cooper
   converts it, wires the Makefile + `data.asm`, and hands you the C to load and
   place it (clipboard + a tab) — **tile numbers computed**, including per-frame
   tiles for a multi-frame sheet (`hero_tiles[frame]`). Paste, **Build**, done.
6. **Big characters** (larger than one hardware sprite): right-click the `.png` →
   **Export Metasprite / Animation (C)…** for a `MetaspriteItem[]` table with the
   correct 8×8 OAM tile names, plus `DECLARE_ANIM_CLIP` for clips — then
   `oamDrawMeta(…)` / `animPlay`/`animTick` in your loop.

**You now have:** art you created inside Cooper, on screen, with the exact C the
library consumes — no hand-counting tile numbers.

---

## 3. Give it sound and collision

**Goal:** a chime when something happens, and things that actually touch.

1. **Author a sound** in any editor (Audacity, sfxr, your DAW…) and export a
   **WAV** — or grab any short WAV you have the rights to.
2. **`Cooper: Add Sound Effect…`** (or right-click the `.wav`). Cooper converts
   it to the soundbank the SNES sound chip needs (resampling to 32 kHz and
   trimming to fit its RAM if needed), wires `USE_SNESMOD` + the soundbank into
   the Makefile, and hands you the C: initialise once (`snesmodInit` — before the
   game loop, it costs a few frames), `snesmodProcess()` each frame, and
   `snesmodPlayEffect(...)` on the event. Paste, **Build**, and you hear it.
3. **Collision** — **`Cooper: Add Snippet…`** → pick from the **Collision**
   category: *AABB overlap* (catching/hitting), *AABB with push-out* (walls and
   platforms), or *tile collision* (a box vs the map). Cooper wires the
   `collision` library module into the Makefile and inserts working, SDK-correct
   code at your cursor (with the `#include`s added).
4. Combine them: when `collideRect(&player, &pickup)` hits, play the chime and
   score. **Build → Run.**

**You now have:** feedback and physics — the two things that make a demo feel
like a game. (This exact chain built Star Catcher, our dogfood game.)

---

## 4. Find and fix a crash

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

## 5. Why did this variable change?

**Goal:** catch the code that writes a variable it shouldn't.

**The fast way — memory trace:** at a debug stop (or standalone), run **`Cooper:
Trace Memory Access (one frame)…`** and give it the symbol (`player_hp`) or
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

## 6. My game drops frames

**Goal:** find where the CPU time goes and whether you fit the frame budget.

1. At a debug stop, run **`Cooper: Run Profiler (one frame)`**.
2. Cooper traces **every instruction of the next frame** and shows:
   - a **per-function table** — master clocks, instruction count, and % of the
     frame, sorted by cost, attributed to **your** symbols;
   - a **per-scanline strip** — darker = busier, so you see *when* in the frame
     the work happens (is your logic spilling out of VBlank?).
3. Fix the top offender, rebuild, profile again — watch the bar shrink.

**You now have:** a real profiler for SNES homebrew (no one else has this) —
data instead of guesses about what's slow.

---

## 7. Turn a bug into a test that never comes back

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

## 8. Ship your game to a real SNES

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

## 9. Let your AI pair on OpenSNES

**Goal:** make Copilot / Claude Code / Cursor actually good at OpenSNES.

1. Run **`Cooper: Configure AI (OpenSNES context)`**. It writes an **`AGENTS.md`**
   with the SNES/OpenSNES rules (the `int`=2 gotcha, BGR555 colour, sprite and
   tilemap limits, the build/run/luna workflow) and **registers luna + the
   OpenSNES SDK as MCP servers**.
2. Reload the window (or start your assistant's agent mode).
3. Now your AI can **look up the real API** from your installed SDK (exact
   signatures, symbol search, hardware constraints) instead of guessing, and —
   the key one — call **`build_and_run`**: one tool that builds your project
   **and** runs it on luna, handing back the compile errors **or a screenshot of
   what it renders plus PPU/CPU state**. Your assistant *sees* the frame and
   self-corrects. For deeper digs it can drive luna directly (peek VRAM/memory,
   breakpoints, traces).
4. Try it: ask your assistant *"make the background blue and verify it"* — watch
   it edit, build, run, look at the frame, and fix itself if it got it wrong.

**You now have:** an assistant that writes correct OpenSNES C and checks itself
in the emulator — the payoff of owning the whole vertical.

---

*Reference for every command, setting and gotcha: the [User Guide](USER_GUIDE.md).*
