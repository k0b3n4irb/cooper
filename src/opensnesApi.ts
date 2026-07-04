// Pure OpenSNES SDK querying for the OpenSNES MCP server — no `vscode` import, so
// it's Node-testable against the real SDK. Powers the MCP tools an AI assistant
// calls to look up exact function signatures, search the API, and get hardware
// constraints straight from the installed SDK headers (better than the static
// AGENTS.md: always matches the user's actual SDK version).

import * as fs from 'fs';
import * as path from 'path';

/** List all `snes/*.h` headers under the SDK's include dir. */
export function listHeaders(sdkPath: string): { name: string; rel: string }[] {
    const dir = path.join(sdkPath, 'lib', 'include');
    const out: { name: string; rel: string }[] = [];
    const walk = (d: string): void => {
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            const full = path.join(d, e.name);
            if (e.isDirectory()) {
                walk(full);
            } else if (e.name.endsWith('.h')) {
                out.push({ name: e.name, rel: path.relative(dir, full) });
            }
        }
    };
    walk(dir);
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function headerFiles(sdkPath: string): string[] {
    const dir = path.join(sdkPath, 'lib', 'include');
    return listHeaders(sdkPath).map((h) => path.join(dir, h.rel));
}

/** Scan backwards from a line index for a `/** … *\/` doc comment. */
function docAbove(lines: string[], i: number): string {
    let end = i - 1;
    while (end >= 0 && lines[end].trim() === '') {
        end--;
    }
    if (end < 0 || !lines[end].includes('*/')) {
        return '';
    }
    let start = end;
    while (start >= 0 && !lines[start].includes('/*')) {
        start--;
    }
    if (start < 0) {
        return '';
    }
    return lines.slice(start, end + 1)
        .map((l) => l.replace(/^\s*\/?\*+\/?/, '').replace(/\*\/\s*$/, '').trim())
        .filter((l) => l !== '')
        .join(' ')
        .trim();
}

export interface ApiHit { symbol: string; header: string; signature: string; doc: string; }

/**
 * Look up a function/macro/type `symbol` in the SDK headers → its declaration line
 * (signature), header, and doc comment. Returns null if not found.
 */
export function lookupApi(sdkPath: string, symbol: string): ApiHit | null {
    const dir = path.join(sdkPath, 'lib', 'include');
    const fnRe = new RegExp(`\\b${symbol}\\s*\\(`);
    const defRe = new RegExp(`^\\s*#\\s*define\\s+${symbol}\\b`);
    for (const file of headerFiles(sdkPath)) {
        let text: string;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        const lines = text.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
            const l = lines[i];
            const isDef = defRe.test(l);
            const isFn = fnRe.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//');
            if (isDef || isFn) {
                return {
                    symbol,
                    header: path.relative(dir, file),
                    signature: l.trim().replace(/\s*[;{]\s*$/, ''),
                    doc: docAbove(lines, i),
                };
            }
        }
    }
    return null;
}

/** Search the SDK headers for declared symbols matching `query` (substring, case-
 *  insensitive). Returns up to `limit` {symbol, header} hits. */
export function searchApi(sdkPath: string, query: string, limit = 40): { symbol: string; header: string }[] {
    const dir = path.join(sdkPath, 'lib', 'include');
    const q = query.toLowerCase();
    const decl = /(?:^\s*#\s*define\s+([A-Za-z_]\w+))|(?:\b([A-Za-z_]\w+)\s*\()/;
    const seen = new Set<string>();
    const out: { symbol: string; header: string }[] = [];
    for (const file of headerFiles(sdkPath)) {
        let text: string;
        try {
            text = fs.readFileSync(file, 'utf8');
        } catch {
            continue;
        }
        for (const line of text.split(/\r?\n/)) {
            const m = decl.exec(line);
            const sym = m && (m[1] || m[2]);
            if (sym && sym.toLowerCase().includes(q) && !seen.has(sym)) {
                seen.add(sym);
                out.push({ symbol: sym, header: path.relative(dir, file) });
                if (out.length >= limit) {
                    return out;
                }
            }
        }
    }
    return out;
}

/** Curated SNES hardware constraints, grounded in the SDK — the facts host
 *  intuition gets wrong. Keyed by topic; call with no topic for the index. */
export const HARDWARE: Record<string, string> = {
    compiler: 'cc65816: `int` is 2 bytes (16-bit), `long` is 4. Use u8/u16/u32, s8/s16/s32 from <snes/types.h>. sizeof(int)==2. Umbrella header <snes.h>.',
    colours: 'CGRAM: 256 colours, 15-bit BGR555 — RGB(r,g,b)=(b<<10)|(g<<5)|r, each channel 0..31 (32768 colours total). Entries 0-127=BG, 128-255=sprites (8 palettes of 16, sprite palette n at 128+n*16). Colour 0 of each sub-palette is transparent.',
    palettes: 'Sub-palette size: 16 for 4bpp, 4 for 2bpp, 256 flat for 8bpp. Mode 0 BG layers each own a distinct CGRAM block.',
    backgrounds: 'BG modes 0-7. Mode 1 = BG1/BG2 4bpp + BG3 2bpp (common). Mode 3 = BG1 8bpp + BG2 4bpp. Mode 7 = 1 BG 8bpp, rotation/scaling. 2bpp=4 colours, 4bpp=16, 8bpp=256. Tiles are 8x8.',
    tilemap: 'Tilemap entry is 16-bit `vhopppcc cccccccc`: tile 0-1023 (bits 0-9), palette (10-12), priority (13), H-flip (14), V-flip (15). Legal map sizes: 32x32, 64x32, 32x64, 64x64. Mode 7 map is 128x128 bytes, no per-cell attributes.',
    sprites: 'OBJ: 128 sprites max, 32 per scanline. Always 4bpp (16 colours), palette from CGRAM 128-255. OBSEL sizes are pairs (small/large), square: 8/16, 8/32, 8/64, 16/32, 16/64, 32/64.',
    vram: 'VRAM 64 KB, word-addressed. OAM 544 bytes (128 sprites + high table).',
    dma: 'Large VRAM/CGRAM transfers use DMA (dmaCopyVram/dmaCopyCGram), during vblank or forced-blank — do not write VRAM/CGRAM mid-frame expecting it to stick.',
    assets: 'Graphics source = an indexed (256-colour) PNG; gfx4snes converts it (build) to .pic (4bpp tiles) + .pal (BGR555) + optional .map. Edit the PNG, not the binaries. Tilemap authoring = Tiled (.tmj) -> tmx2snes.',
};

export function hardwareConstraint(topic?: string): string {
    if (!topic) {
        return 'Topics: ' + Object.keys(HARDWARE).join(', ') + '. Call hardware_constraint(topic) for one.';
    }
    const key = topic.toLowerCase().replace(/s$/, '');
    const hit = HARDWARE[topic.toLowerCase()] ?? HARDWARE[key] ?? HARDWARE[key + 's'];
    return hit ?? `No constraint for "${topic}". Topics: ${Object.keys(HARDWARE).join(', ')}.`;
}
