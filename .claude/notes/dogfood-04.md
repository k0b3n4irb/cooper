# Dogfood #4 — "Crystal Cavern" (2026-07-11)

Fourth loop: a **real level through New Tilemap** (D-082) — original tileset,
painted map, per-tile collision, a spawn — out-of-tree at
`~/workspace/cooper-dogfood/cavern`. **Outcome: full success after two real
findings**, both fixed/filed the same day. Proofs in luna: the painted level
renders (starry cave, grass/dirt floor, crystals, mist); holding Right the hero
**stops dead at the brick wall** (OAM X pinned at 208 across samples — T_SOLID);
holding Left the **spike strip respawns him** (OAM X never below 64; without
collision he bottomed out at 8). The Entities spawn round-tripped **byte-exact**
into `.o16` (`4001 b800 0500` = x320, y184, type 5).

## What worked immediately

- **The whole authoring chain**: Cooper-generated `.tmj` → painted (as Tiled
  writes it) → `attribute`/`palette`/`priority` per tile → `tmx2snes` → build.
  First `make` after painting: converted + linked, no manual step.
- **The viewer-verify loop again**: measuring the *rendered* screenshot columns
  against the painted columns is what caught the camera-semantics confusion in
  minutes.

## Findings (the real dogfood value)

### F14 — `mapGetMetaTilesProp` is BROKEN from C (upstream bug → opensnes#103)
The documented collision API returns garbage when called from C: it reads its
WRAM table (`metatilesprop`, linked at **$7E:3000**) with the **caller's data
bank** (`lda metatilesprop,x` after `plb`), and C runs with DB=$00 — $00:3000 is
not a WRAM mirror. No SDK example calls it (they all use the object engine), so
nothing ever caught it — the same "works from asm, broken from C" landmine class
as audio.h (D-069). **Filed opensnes#103** with the asm analysis + suggested
`lda.l` fix.

### F15 — far data is NOT C-readable (the near-pointer trap, live)
First workaround attempt read the converted map directly from C — and still
failed: the example layout pins map data in **bank 2**, and cc65816's near
pointers silently read bank 0 instead. AGENTS.md warns about exactly this; now
we've hit it for real. **Fix shipped in the scaffold (0.62.1)**: New Tilemap's
`data.asm` puts map data in **bank 0** (a 64×32 map ≈ 4 KB of ~19 KB free), and
the snippet ships a **working C collision read-back** (`<map>_prop(x,y)`: m16
entry → attribute) instead of the broken API — swap back once #103 lands.

### F16 — `mapUpdateCamera(x,y)` takes the PLAYER position, not the camera origin
The doc says "camera position"; it actually centres the view on the given
coordinates (mapandobjects passes `mariox`). Cost an hour of "the wall isn't
where I painted it". The generated snippet now passes the player position and
says so.

### Debug-tooling note (self-inflicted, worth remembering)
An MCP `peek_memory` probe session chased ghosts because I mis-parsed the
response envelope (`structuredContent.bytes`) — every read looked like 0. The
OAM channel (state.ppu.oam_full) stayed the reliable oracle. Lesson: when a
probe contradicts on-screen behaviour, distrust the probe first.

## Net

New Tilemap survives contact with reality: **author → paint → collision →
spawn → verified on hardware**, with the product patched the same day so users
get working collision out of the box (0.62.1) and the API bug filed upstream
(#103). Next map-side candidates: consume `.o16` spawns in a snippet (object
engine starter), and swap the read-back for `mapGetMetaTilesProp` when #103
ships.
