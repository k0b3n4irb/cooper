# Dogfood #1 — "stardodge" (2026-07-08)

First dogfood loop of the vision (Phase C): build a real game using only the
Cooper flow, note every friction. Game: a ship you move with the D-pad. Lives
out-of-tree at `~/workspace/cooper-dogfood/stardodge`. **Outcome: playable +
verified in luna** (ship on screen; OAM X 112→190 holding Right). The point isn't
the game — it's the friction, which now prioritises the Workshop.

## What worked (the moat holds)

- **Create New Game → builds first try.** Genre → generated Makefile + starter +
  `.cooper/graphics.json` → `make` → `.sfc`. Smooth.
- **Verification loop is a superpower.** Proving "the ship moves" took seconds via
  luna: screenshot + reading OAM X. A real dev debugging their game gets this for
  free — no other SNES stack does.
- luna as the single backend (run/screenshot/state/input) made the whole check
  trivial and deterministic.

## Frictions (ranked)

### F1 — The art→game bridge is a cliff (THE finding)
After the wizard, the instant I added a sprite I had to hand-write, with zero
guidance:
- a `gfx4snes` rule with cryptic flags: `-s 32 -o 16 -u 16 -p -i`;
- a `data.asm` with `.section ".rodata1" superfree` + `.incbin "res/ship.pic"` +
  export labels (`ship`/`ship_end`/`ship_pal`);
- `extern u8 ship[], ship_end[]; extern u8 ship_pal[];` in C;
- the VRAM/CGRAM addressing: `dmaCopyVram(ship, 0x2100, …)`,
  `dmaCopyCGram(ship_pal, OBJ_CGRAM_BASE, PALETTE_16_SIZE)`, and the tile number
  `0x0010 = ($2100 - $2000)/16`.
This is the wall between "guided wizard" and "a game with a sprite." A beginner
stops here.

### F2 — Tile-number / VRAM math is arcane
`0x0010 = ($2100-$2000)/16` is not derivable by a newcomer. Same class as the
metasprite char-name problem Cooper already solved (D-064) — Cooper should
compute it.

### F3 — The starter main.c is too minimal to launch from
It sets the mode + a blank screen. The distance to "something moving" is large
and entirely manual. GB Studio shows you a controllable character immediately;
our shmup starter shows a black screen.

### F4 — OAM must be rebuilt every frame
`oamSet` + `oamSetSize` have to be re-called inside the loop; not obvious, easy
to get a one-frame or vanishing sprite. The pattern should be encoded.

### F5 — The tile editor can't create a *new* sprite at the mode's constraints
I used a stand-in PNG. A user would want "New 16×16, 16-colour sprite" seeded to
the project's mode — not only editing an existing PNG. (Feeds Phase B.)

## Priorities this sets (feeds the roadmap)

- **P1 — `Cooper: Add Sprite…` (the art→code scaffolder). ✅ SHIPPED 0.48.0
  (D-068).** From a PNG: runs gfx4snes, generates the `data.asm` incbin bridge,
  wires the Makefile, and hands back the C snippet (clipboard + tab) with the
  tile number handled (`oamInitGfxSet` → tile 0). Kills F1/F2/F4. Verified by
  building the scaffolded output.
- **P2 — richer per-genre starters (A3).** The shmup starter ships a controllable
  ship (what I hand-wrote), so New Game → Run → *you already move something*.
- **P3 — tile editor "New Sprite at mode constraints" (Phase B).** Addresses F5.

Net: the dogfood confirms the strategy (the wizard + moat are great) and points
the next work squarely at **closing the art→code gap** — exactly the Onramp
pillar. Next dogfood loop (add a target + collision + score) will test the
`object`/`collision`/`map` paths and the audio audition.
