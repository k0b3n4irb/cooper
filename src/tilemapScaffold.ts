// Pure "New Tilemap" scaffolding — no `vscode` import, Node-testable (D-082).
//
// The maps counterpart of Add Sprite/Add Sound: the SDK's map pipeline is
// Tiled-based (author a .tmj in Tiled → `tmx2snes` → .m16 map + .b16 collision
// attributes + .o16 objects + .t16 tile props → `mapLoad()`), and the cliff is
// the WIRING, not the editor. This generates a ready-to-paint .tmj bound to the
// project's tileset PNG, the Makefile rules, the data.asm bridge, and the C.
// Grounded byte-for-byte in examples/maps/tiled (Makefile flags, section/bank
// layout, mapLoad pattern) and the example's authored maplevel01.tmj.

/** A safe C/asm identifier from a map name (e.g. `level1`). */
export function mapSymbolBase(name: string): string {
    const id = name.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_').replace(/^([0-9])/, '_$1');
    return id || 'level';
}

export interface TmjOpts {
    /** Map size in 8×8 tiles. MUST be even (the map engine works in 16×16 metatiles). */
    widthTiles: number;
    heightTiles: number;
    /** Tileset PNG file name (relative to the .tmj, e.g. `tileset.png`). */
    tilesetImage: string;
    /** Tileset PNG pixel size (8×8 tiles are derived from it). */
    imageWidth: number;
    imageHeight: number;
}

/**
 * A minimal, valid Tiled JSON map the SDK's `tmx2snes` converts: orthogonal
 * 8×8, one tile layer named `BG1` (→ `BG1.m16`), one `Entities` object layer
 * (spawns authored in Tiled → `.o16`), and an embedded tileset carrying the
 * SDK's per-tile properties (`attribute` = collision, `palette`, `priority`)
 * pre-declared on every tile so they're one click away in Tiled.
 */
export function renderTmj(o: TmjOpts): string {
    const columns = Math.floor(o.imageWidth / 8);
    const tilecount = columns * Math.floor(o.imageHeight / 8);
    const tiles = Array.from({ length: tilecount }, (_, id) => ({
        id,
        properties: [
            { name: 'attribute', type: 'string', value: '0' },
            { name: 'palette', type: 'string', value: '0' },
            { name: 'priority', type: 'string', value: '0' },
        ],
    }));
    const tmj = {
        compressionlevel: -1,
        width: o.widthTiles,
        height: o.heightTiles,
        infinite: false,
        orientation: 'orthogonal',
        renderorder: 'right-down',
        tiledversion: '1.10.2',
        tilewidth: 8,
        tileheight: 8,
        type: 'map',
        version: '1.10',
        nextlayerid: 3,
        nextobjectid: 1,
        layers: [
            {
                id: 1, name: 'BG1', type: 'tilelayer', visible: true, opacity: 1, x: 0, y: 0,
                width: o.widthTiles, height: o.heightTiles,
                // gid 1 = the tileset's first tile everywhere — paint over it in Tiled.
                data: '__DATA__',
            },
            { id: 2, name: 'Entities', type: 'objectgroup', visible: true, opacity: 1, x: 0, y: 0, draworder: 'topdown', objects: [] },
        ],
        tilesets: [{
            firstgid: 1,
            name: o.tilesetImage.replace(/\.png$/i, ''),
            image: o.tilesetImage,
            imagewidth: o.imageWidth,
            imageheight: o.imageHeight,
            tilewidth: 8, tileheight: 8,
            columns, tilecount, margin: 0, spacing: 0,
            tiles,
        }],
    };
    // tmx2snes's parser (cute_tiled) rejects `": "` after keys AND numeric arrays
    // split one-per-line — serialize exactly like Tiled does (grounded 2026-07-11:
    // this form converts the SDK example to byte-identical .m16/.b16/.t16).
    const data = new Array(o.widthTiles * o.heightTiles).fill(1).join(', ');
    return JSON.stringify(tmj, null, 1)
        .replace(/": /g, '":')
        .replace('"__DATA__"', `[${data}]`) + '\n';
}

/** The tileset gfx rule — the example's exact flags (`-s 8 -o 48 -u 16 -p -m`;
 *  `-m` emits the tileset `.map` tmx2snes needs). Idempotent by target. */
export function tilesetGfxRule(pngRel: string): string {
    const b = pngRel.replace(/\.png$/i, '');
    return `${b}.pic ${b}.pal ${b}.map: ${pngRel}\n\t@echo "[GFX] $< -> tileset"\n\t@$(GFX4SNES) -s 8 -o 48 -u 16 -p -m -i $<\n`;
}

/** The tmx2snes rule + the TMX2SNES tool var (once) + the combined.asm dep. */
export function tmx2snesRule(tmjRel: string, tilesetPngRel: string): string {
    const dir = tmjRel.includes('/') ? tmjRel.slice(0, tmjRel.lastIndexOf('/')) : '.';
    const tmjName = tmjRel.slice(tmjRel.lastIndexOf('/') + 1);
    const base = tmjRel.replace(/\.tmj$/i, '');
    const tsMap = tilesetPngRel.replace(/\.png$/i, '.map');
    const tsMapName = tsMap.slice(tsMap.lastIndexOf('/') + 1);
    return `${dir}/BG1.m16 ${base}.t16 ${base}.b16: ${tmjRel} ${tsMap}\n`
        + `\t@echo "[TMX] $< -> map binaries"\n`
        + `\t@cd ${dir} && $(TMX2SNES) ${tmjName} ${tsMapName}\n`;
}

/** Idempotently append the whole Makefile wiring for a map (tool var, rules, dep). */
export function appendMapRules(makefile: string, tmjRel: string, tilesetPngRel: string): string {
    let mk = makefile;
    if (!/^TMX2SNES\s*:?=/m.test(mk)) {
        mk = mk.replace(/^([ \t]*include\s+\$\(OPENSNES\)\/make\/common\.mk.*)$/m, `TMX2SNES := $(OPENSNES)/bin/tmx2snes\n$1`);
    }
    const tsBase = tilesetPngRel.replace(/\.png$/i, '');
    if (!mk.includes(`${tsBase}.map:`) && !mk.includes(`${tsBase}.map `)) {
        mk = mk.replace(/\s*$/, '\n') + '\n' + tilesetGfxRule(tilesetPngRel);
    }
    if (!mk.includes(`${tmjRel.replace(/\.tmj$/i, '')}.t16`)) {
        mk = mk.replace(/\s*$/, '\n') + '\n' + tmx2snesRule(tmjRel, tilesetPngRel);
        const dir = tmjRel.includes('/') ? tmjRel.slice(0, tmjRel.lastIndexOf('/')) : '.';
        mk += `combined.asm: ${tsBase}.pic ${dir}/BG1.m16\n`;
    }
    return mk;
}

/** The data.asm bridge: tileset in a superfree bank, the ~13 KB of map data
 *  pinned out of bank $00 (the example's layout — mapLoad honours bank bytes). */
export function mapDataAsmSection(base: string, tmjRel: string, tilesetPngRel: string): string {
    const dir = tmjRel.includes('/') ? tmjRel.slice(0, tmjRel.lastIndexOf('/')) : '.';
    const tmjBase = tmjRel.replace(/\.tmj$/i, '');
    const tsBase = tilesetPngRel.replace(/\.png$/i, '');
    return `.section ".rodata_${base}_ts" superfree\n`
        + `${base}_tiles:\n.incbin "${tsBase}.pic"\n${base}_tiles_end:\n`
        + `${base}_pal:\n.incbin "${tsBase}.pal"\n${base}_pal_end:\n.ends\n\n`
        + `; map data in bank 0 ON PURPOSE: the C collision read-back (the snippet's\n`
        + `; tileProp) needs near-readable data — mapGetMetaTilesProp reads its WRAM\n`
        + `; table with the caller's DB and returns garbage from C (upstream bug).\n`
        + `.section ".rodata_${base}_map" semifree bank 0\n`
        + `${base}_map:\n.incbin "${dir}/BG1.m16"\n`
        + `${base}_att:\n.incbin "${tmjBase}.b16"\n`
        + `${base}_def:\n.incbin "${tmjBase}.t16"\n.ends\n`;
}

/** The C snippet: externs + a WORKING collision read-back + bg init + mapLoad +
 *  a player/camera loop. (Not mapGetMetaTilesProp: it reads its WRAM table with
 *  the caller's DB and returns garbage from C — found in dogfood #4, upstream
 *  issue filed; tileProp does the same lookup from the converted data.) */
export function mapSnippet(base: string, widthTiles: number): string {
    const maxX = (widthTiles - 2) * 8;
    return `// --- ${base}: generated by Cooper (New Tilemap) ---\n`
        + `// 1) at the top of the file:\n`
        + `#include <snes/map.h>\n`
        + `extern u8 ${base}_tiles[], ${base}_tiles_end[];\n`
        + `extern u8 ${base}_pal[], ${base}_pal_end[];\n`
        + `extern u8 ${base}_map[], ${base}_def[], ${base}_att[];\n`
        + `u16 playerX = 200;   /* world-space, pixels */\n\n`
        + `// collision read-back: the 'attribute' you set in Tiled (T_SOLID, T_SPIKE…)\n`
        + `// at world pixel (x,y). m16 = 6-byte header + u16 tile entries, row-major.\n`
        + `static u16 ${base}_prop(u16 x, u16 y) {\n`
        + `    u16 idx = (y >> 3) * ${widthTiles} + (x >> 3);\n`
        + `    u16 tile = (${base}_map[6 + idx * 2] | (${base}_map[7 + idx * 2] << 8)) & 0x03FF;\n`
        + `    return ${base}_att[tile << 1] | (${base}_att[(tile << 1) + 1] << 8);\n`
        + `}\n\n`
        + `// 2) in main(), before setScreenOn:\n`
        + `bgInitTileSet(0, ${base}_tiles, ${base}_pal, 0,\n`
        + `              ${base}_tiles_end - ${base}_tiles,\n`
        + `              ${base}_pal_end - ${base}_pal, BG_16COLORS, 0x2000);\n`
        + `bgSetMapPtr(0, 0x6800, SC_64x32);\n`
        + `setMode(BG_MODE1, 0);\n`
        + `setMainScreen(LAYER_BG1);\n`
        + `WaitForVBlank();\n`
        + `mapLoad(${base}_map, ${base}_def, ${base}_att);\n\n`
        + `// 3) the game loop (walk with the D-pad; solid tiles block you):\n`
        + `while (1) {\n`
        + `    u16 pad = padHeld(0);\n`
        + `    mapUpdate();\n`
        + `    if ((pad & KEY_RIGHT) && playerX < ${maxX}\n`
        + `        && ${base}_prop(playerX + 16, 184) != T_SOLID) playerX++;\n`
        + `    if ((pad & KEY_LEFT) && playerX > 8\n`
        + `        && ${base}_prop(playerX - 1, 184) != T_SOLID) playerX--;\n`
        + `    mapUpdateCamera(playerX, 0);   /* takes the PLAYER pos — it follows */\n`
        + `    WaitForVBlank();\n`
        + `    mapVblank();\n`
        + `}\n\n`
        + `// spawns: objects you placed on the Entities layer are in ${base}_o16 —\n`
        + `// objLoadObjects() + the object engine consume them (games/mapandobjects).\n`;
}
