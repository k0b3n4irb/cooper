# Dogfood #2 — "Star Catcher" (2026-07-08)

Second dogfood loop, going deeper than #1 (which was one moved sprite on black —
honestly unimpressive). Goal: a **real, showable micro-game with original art**:
pilot a ship along the bottom, catch falling stars, score climbs, **a chime
plays on each catch**. Two sprites + text HUD + collision + original sound — the
paths #1 didn't touch. Out-of-tree at `~/workspace/cooper-dogfood/starcatcher`.

**Outcome: a complete playable game, verified in luna.** Deep-space backdrop,
"STAR CATCHER" title, live SCORE, a star falling, the ship at the bottom. A
scripted input run (hold Left 40 frames to slide the ship under the star)
deterministically caught the first star — **SCORE 0 → 1** — proving the whole
loop (move → fall → AABB collision → score → respawn) in seconds.
Screenshots: `starcatcher/screenshots/{title,score1}.png`.

## What worked (the moat holds, again)

- **Original art in minutes.** Any indexed-PNG tool → one sprite sheet →
  `gfx4snes` → `.incbin`. Once wired, clean and repeatable.
- **The verify loop is still the superpower.** `luna state --input
  "0:0x200,40:0" -n 5000000 --screenshot` *proved a catch* with no human in the
  loop — the score reads `1`. No other SNES stack gives you a scriptable,
  deterministic "did my gameplay actually work" in one command.

## Frictions (ranked — these set the Workshop priorities)

### F6 — `TARGET` vs `ROM_NAME` is a silent-failure trap
`TARGET` is the output `.sfc`; `ROM_NAME` is the 21-char header string. Setting
only `ROM_NAME` makes the build "succeed" building **nothing**, then dies in the
summary with `syntax error near unexpected token '|'` (empty `$(TARGET)` in a
shell `wc`). Inscrutable. And `ROM_NAME` with a space/quotes corrupts the header
(`NAME requires a string of 1 to 21 letters`). **Cooper must own the Makefile —
a user should never hand-author these two.** (The generator already sets both
correctly; the lesson is *never hand-edit the Makefile*.)

### F7 — `GFXSRC` silently demands a header the flow doesn't emit
Setting `GFXSRC := res/sprites.png` makes `common.mk` add `sprites.h` as a
prerequisite of **every** `.c.o`, but the gfx rule emits `.pic/.pal/.inc`, not a
`.h` → make rejects the pattern rule and prints the misleading `No rule to make
target 'main.c.o'`. The proven pattern is breakout's: **explicit `gfx4snes` rule
+ `ASMSRC` `.incbin`**, no `GFXSRC`. (Also: the var is `ASMSRC`, not `AS_SRC` —
a wrong name silently drops your `data.asm`.) → Cooper's `Add Sprite` already
does the `.incbin` bridge; the takeaway is it should be the *only* way assets get
wired, sheets included.

### F8 — Multi-sprite tile addressing (the sheet stride)
Two 16×16 frames in one 32×16 sheet: frame 0 = tile **0**, frame 1 = tile **2**
(stride 2, from gfx4snes's default `-o 16` name-table width — `-s 16` alone padded
to 32 tiles). Non-obvious, undocumented, same arithmetic class as the metasprite
char-name problem (D-064). → the tooling needs a **sprite-sheet concept**: name a
frame, get its tile number; never hand-compute stride.

### F9 — Text HUD + sprites coexistence = a manual VRAM map
`textModeInit()` is a lovely one-liner but it hard-codes Mode 0 / BG1, font at
VRAM `$0000`, tilemap `$3800`, and `setMainScreen(LAYER_BG1)` (BG only). To add
sprites you must *know* to (a) OR in `LAYER_OBJ`, and (b) place sprite VRAM clear
of the font and tilemap (I used `$6000`). That VRAM map is required knowledge a
beginner doesn't have. → a "HUD + sprites" starter/snippet that encodes a safe
default layout.

### F10 — Sound (RESOLVED — original SFX, verified)
The catch now plays a **home-synthesised "catch" chime** — no borrowed asset.
Path taken and what it taught:

- **`audio.h` (direct BRR, `audioLoadSample`) is unusable from C.** `audio.asm`
  carries a warning: its functions use the PVSnesLib right-to-left / 1-byte-slot
  ABI, incompatible with cc65816 → *"multi-arg functions called from C operate on
  garbage."* No example exercises it. So the direct-BRR route is dead for C.
  (Already documented upstream in `opensnes/.claude/notes/tech/
  audio_legacy_pvsneslib_abi.md` — a known gap, not worth a duplicate issue, but
  a landmine a beginner would hit.)
- **The working path is snesmod + a soundbank `.it`** (what likemario uses).
  `smconv` only ingests `.it`. To stay original I **generated a minimal but
  spec-valid Impulse Tracker `.it` in Python** (one 16-bit signed sample = a
  synthesized two-tone chime, sample-only mode, one pattern). `smconv` accepted
  it → `SFX_CATCH`. Wired via `USE_SNESMOD := 1` + `SOUNDBANK_SRC`, then
  `snesmodInit` / `snesmodSetSoundbank` / `snesmodLoadEffect(SFX_CATCH)` /
  `snesmodProcess()` each frame / `snesmodPlayEffect(...)` on catch.
- **Verified in luna, not on faith.** `luna state`'s `apu` subtree renders real
  DSP output; at the catch frame a voice keys on — `active_voices=1`, `kon=128`,
  `voice_envelope≈2032`, `last_audio_sample=[-4859,-5600]` — then silence again
  (the ~155 ms transient). Calibrated the method first against likemario's
  continuous music (voices always active) and the sfx example.

**New frictions this surfaced (feed the roadmap):**
- **F11 — no `.it` authoring path in the toolchain.** `smconv` needs `.it`; there
  is no bundled way to turn a `.wav`/`.brr`/raw waveform into one. I hand-rolled
  an IT writer. → **Audio v2** should own exactly this: author/import a sample →
  emit a soundbank, with in-editor audition. This is the confirmed next audio
  slice, and it's squarely the "own the differentiator, integrate the commodity"
  line (we don't build a tracker; we build the SNES bridge + audition).
- **F12 — `snesmodInit()` blocks several frames (SPC driver upload), which
  silently shifts any pre-tuned input timing.** My scripted-input catch test
  (from the no-sound build) stopped landing once audio init was added. Fix for
  verification: make the first star drop onto the ship's start column so the
  catch is input-independent (also nicer first-second feedback). → starters/docs
  must teach that audio init costs frames and belongs before the game loop.

## What this sharpens for the roadmap

The #1 finding stands and deepens: **Cooper should own the entire
art → sheet → VRAM → OAM → HUD chain**, not just a single sprite.

- **Extend `Add Sprite` to sprite *sheets*** (multi-frame): pick a PNG grid, get
  named frames with their tile numbers computed (kills F8), wired via the
  `ASMSRC`/`.incbin` bridge (kills F7).
- **Never hand-edit the Makefile** — the generator is the source of truth (F6).
- **Richer starters** that already show a *controllable, catchable* object with a
  HUD on screen (F9), so New Game → Run = you're already playing (still A3).
- **Audio v2 is now concrete (F10/F11):** own the *sample/`.it` → soundbank*
  bridge + in-editor audition (the direct-BRR C API is broken; snesmod+`.it` is
  the only path, and nothing today turns a waveform into an `.it`). Ship a couple
  of ready-made SFX + the authoring step so a beginner never hand-rolls a tracker
  module — as I just had to.

Net: dogfood #2 produced something worth showing *and* a precise, ranked work
list. The strategy holds; the next Workshop slice is the sheet-aware `Add Sprite`.
