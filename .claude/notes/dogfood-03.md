# Dogfood #3 — "Star Catcher", end-to-end through the Cooper tools (2026-07-09)

Third dogfood loop: **re-make Star Catcher using only Cooper's own command
outputs**, to prove the onramp features built in 0.48→0.52 actually *compose*
into a real game — and to runtime-validate two things that had only ever been
syntax/format-checked. Out-of-tree at `~/workspace/cooper-dogfood/starcatcher`.

**Outcome: the composed toolchain produces a real, playing, sounding game** with
SDK collision, verified in luna (SCORE 1 after the first catch; a DSP voice keys
on at the catch — `active_voices=1`, `voice_envelope≈2032`, real output samples).

## What each Cooper piece contributed (the chain)

- **Create New Game / project generator** (`projectGen`) → the Makefile + starter.
- **Add Sprite → sheet** (`sheetFrameTiles`) → the ship+star sheet with frame
  tiles computed (0, 2) — the numbers now also cross-checked vs `gfx4snes -T`.
- **Add Sound Effect** (`decodeWav` + `buildIt`) → authored an original catch
  chime as a **WAV**, ran it through the real pipeline → `sfx/catch.it` →
  soundbank. (Replaced the hand-rolled `.it` from dogfood #2.)
- **Insert Snippet → Collision** (`ensureModules` + the AABB snippet) → wired the
  `collision` module into the Makefile and swapped the hand-rolled `overlaps()`
  for the SDK's `Rect` + `collideRect`.

## What this validated that was previously unproven

- **The collision snippet RUNS, not just compiles.** D-070 only had a
  `clang -fsyntax-only` check. Now `rectInit` + `collideRect` actually catch the
  star in a running ROM — the SDK collision path works from cc65816 C.
- **The Add Sound WAV path works in a real game.** D-069's Node test proved
  `smconv` accepts the generated `.it`; here an authored **WAV** → `buildIt` →
  soundbank → a real SPC voice firing on the catch. The whole
  WAV→`.it`→soundbank→play road holds.
- **The pieces compose.** Each command's pure output slotted into the next with
  no surprises; the Makefile ended up with the right modules and the game built
  first try after the edits.

## Frictions (what's still manual — feeds the roadmap)

- **F13 — you still assemble the starter by hand.** Cooper hands back four
  correct fragments (sheet load, sound init, collision check, HUD), but the
  *user* wires them into one `main.c`: include order, the `snesmodInit`
  costs-frames rule (F12), the text-on-BG1 + sprites-on-OBJ VRAM coexistence
  (F9). Code-first is the point — but a per-genre **starter that already
  composes these** (A3) would turn "New Game → Run" into "you're already playing
  a catcher with sound", not a black screen. This is the clearest next onramp
  win the dogfood keeps pointing at.
- **F9 / F12 unchanged** (VRAM map + audio-init timing are still knowledge the
  user must have). A "HUD + sprites + sound" starter would encode both.

## Net

The moat + the onramp now form a working chain: from `Create New Game` to a
sprite sheet, an original sound, and SDK collision — a real game, verified on
cycle-accurate hardware, entirely from Cooper's outputs. The remaining gap is
**composition** (F13): ship starters that pre-wire the fragments, so the 90% get
a moving, scoring, sounding game on the first Run. That is Phase A3, now the
top-priority onramp slice.
