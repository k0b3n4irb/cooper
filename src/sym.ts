// Pure WLA `.sym` parser — no `vscode` import, Node-testable. The symbol layer
// for the ASM/symbol-level debugger: resolves label↔address both ways.
//
// Format grounded from the real wlalink-generated file
// (opensnes/examples/.../aim_target.sym) and the assembler/linker source.
// Sections are `[name]` headers; data lines follow until the next header.
//   [information]  key value           (e.g. `version 3`, `wlasymbol true`)
//   [labels]       BB:AAAA name        bank:CPU-addr (hex) then the label
//   [definitions]  VVVVVVVV name       8-hex value then the name
//   [sections]     ROMOFF BB:AAAA SLOT SIZE name
//   [ramsections]  BB:AAAA SLOT SIZE name
// Names legitimately contain `:`, `@`, `.` (cproc/QBE block labels like
// `main@start.86`, `oamSet@in_range`) — so label lines split on the FIRST space
// only. Lines starting with `;` and blank lines are comments. When the build
// later enables `wla -i` + `wlalink -A`, an `[addr-to-line mapping v2]` section
// appears — parsed here too (lineMap) but absent in today's labels-only `.sym`.

export interface SymLabel {
    /** 24-bit address: bank << 16 | offset. */
    addr: number;
    bank: number;
    offset: number;
    name: string;
}

export interface SymSection {
    addr: number;
    bank: number;
    offset: number;
    size: number;
    name: string;
    /** ROM file offset (sections only; undefined for ramsections). */
    romOffset?: number;
    kind: 'rom' | 'ram';
}

export interface SymLineEntry {
    /** 24-bit PC address. */
    addr: number;
    /** Source-file key `OBJ:SRC` (indexes `sourceFiles`). */
    fileKey: string;
    /** Line in the referenced (generated) asm file. */
    asmLine: number;
}

export interface SymTable {
    info: Record<string, string>;
    labels: SymLabel[];
    /** name → addr (first occurrence wins). */
    byName: Map<string, number>;
    /** addr → label names at that exact address (multiple labels can coincide). */
    byAddr: Map<number, string[]>;
    sections: SymSection[];
    /** Sorted (ascending) unique label addresses, for nearest-preceding lookup. */
    sortedAddrs: number[];
    /** `OBJ:SRC` → source filename (from `[source files v2]`). */
    sourceFiles: Map<string, string>;
    /** Present only when the build emitted addr-to-line data (-i/-A); else empty. */
    lineMap: SymLineEntry[];
    /** True iff an addr-to-line section was present. */
    hasLineInfo: boolean;
}

function parseBankAddr(tok: string): { bank: number; offset: number; addr: number } | null {
    const m = tok.match(/^([0-9a-fA-F]{1,2}):([0-9a-fA-F]{1,4})$/);
    if (!m) {
        return null;
    }
    const bank = parseInt(m[1], 16);
    const offset = parseInt(m[2], 16);
    return { bank, offset, addr: (bank << 16) | offset };
}

/** Parse a WLA `.sym` file's text into a structured symbol table. */
export function parseSym(text: string): SymTable {
    const t: SymTable = {
        info: {},
        labels: [],
        byName: new Map(),
        byAddr: new Map(),
        sections: [],
        sortedAddrs: [],
        sourceFiles: new Map(),
        lineMap: [],
        hasLineInfo: false,
    };

    let section = '';
    for (const raw of text.split(/\r?\n/)) {
        const line = raw.trim();
        if (line === '' || line.startsWith(';')) {
            continue;
        }
        const header = line.match(/^\[(.+)\]$/);
        if (header) {
            section = header[1].toLowerCase();
            if (section.startsWith('addr-to-line')) {
                t.hasLineInfo = true;
            }
            continue;
        }

        switch (section) {
            case 'information': {
                const sp = line.indexOf(' ');
                if (sp > 0) {
                    t.info[line.slice(0, sp)] = line.slice(sp + 1).trim();
                }
                break;
            }
            case 'labels': {
                // `BB:AAAA name` — split on the FIRST space; the name keeps : @ .
                const sp = line.indexOf(' ');
                if (sp <= 0) {
                    break;
                }
                const ba = parseBankAddr(line.slice(0, sp));
                if (!ba) {
                    break;
                }
                const name = line.slice(sp + 1).trim();
                t.labels.push({ addr: ba.addr, bank: ba.bank, offset: ba.offset, name });
                if (!t.byName.has(name)) {
                    t.byName.set(name, ba.addr);
                }
                const at = t.byAddr.get(ba.addr);
                if (at) {
                    at.push(name);
                } else {
                    t.byAddr.set(ba.addr, [name]);
                }
                break;
            }
            case 'sections':
            case 'ramsections': {
                const parts = line.split(/\s+/);
                // sections:    ROMOFF BB:AAAA SLOT SIZE name
                // ramsections:        BB:AAAA SLOT SIZE name
                const isRom = section === 'sections';
                const baTok = isRom ? parts[1] : parts[0];
                const ba = baTok ? parseBankAddr(baTok) : null;
                if (!ba) {
                    break;
                }
                const sizeTok = isRom ? parts[3] : parts[2];
                const nameIdx = isRom ? 4 : 3;
                const size = parseInt(sizeTok, 16);
                const name = parts.slice(nameIdx).join(' ');
                t.sections.push({
                    addr: ba.addr, bank: ba.bank, offset: ba.offset,
                    size: Number.isNaN(size) ? 0 : size,
                    name,
                    romOffset: isRom ? parseInt(parts[0], 16) : undefined,
                    kind: isRom ? 'rom' : 'ram',
                });
                break;
            }
            default: {
                if (section.startsWith('source files')) {
                    // `OBJ:SRC checksum filename`
                    const parts = line.split(/\s+/);
                    if (/^[0-9a-fA-F]{1,4}:[0-9a-fA-F]{1,4}$/.test(parts[0]) && parts.length >= 3) {
                        t.sourceFiles.set(parts[0], parts.slice(2).join(' ').trim());
                    }
                } else if (section.startsWith('addr-to-line')) {
                    // `ROMOFF BB:AAAA SLOT FILEID:SRC:LINE`  (when -i/-A are on)
                    const parts = line.split(/\s+/);
                    const ba = parts[1] ? parseBankAddr(parts[1]) : null;
                    const tail = parts[3]; // FILEID:SRC:LINE
                    if (ba && tail) {
                        const f = tail.split(':');
                        if (f.length === 3) {
                            t.lineMap.push({ addr: ba.addr, fileKey: `${f[0]}:${f[1]}`, asmLine: parseInt(f[2], 16) });
                        }
                    }
                }
                break;
            }
        }
    }

    t.sortedAddrs = [...t.byAddr.keys()].sort((a, b) => a - b);
    return t;
}

/** Resolve a symbol name to its 24-bit address, or undefined. */
export function symbolToAddr(t: SymTable, name: string): number | undefined {
    return t.byName.get(name);
}

/**
 * Parse a literal address: `BB:OOOO`, `$xxxxxx`, `0xxxxxxx`, or bare hex (1–6
 * digits). Returns a 24-bit address or undefined. (Bare values are hex — the
 * convention for an asm debugger.)
 */
export function parseAddress(s: string): number | undefined {
    const str = s.trim();
    const ba = str.match(/^([0-9a-fA-F]{1,2}):([0-9a-fA-F]{1,4})$/);
    if (ba) {
        return ((parseInt(ba[1], 16) << 16) | parseInt(ba[2], 16)) >>> 0;
    }
    const hx = str.match(/^(?:\$|0x)?([0-9a-fA-F]{1,6})$/);
    if (hx) {
        return parseInt(hx[1], 16) >>> 0;
    }
    return undefined;
}

/** Resolve an expression to a 24-bit address: a `.sym` symbol first, else a literal. */
export function resolveExpr(t: SymTable, expr: string): number | undefined {
    return symbolToAddr(t, expr.trim()) ?? parseAddress(expr);
}

export interface ResolvedAddr {
    /** The nearest label at or before the address. */
    name: string;
    /** That label's address. */
    addr: number;
    /** addr - label.addr (0 = exact hit). */
    delta: number;
}

/**
 * Resolve a 24-bit address to its nearest-preceding label (e.g. `InitHardware+6`).
 * `maxDelta` caps how far past a label still resolves (undefined = no cap).
 * Returns undefined if no label precedes the address (or the gap exceeds maxDelta).
 */
export function addrToSymbol(t: SymTable, addr: number, maxDelta?: number): ResolvedAddr | undefined {
    const a = t.sortedAddrs;
    if (a.length === 0) {
        return undefined;
    }
    // binary search for the largest addr <= target
    let lo = 0, hi = a.length - 1, best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (a[mid] <= addr) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    if (best < 0) {
        return undefined;
    }
    const labelAddr = a[best];
    const delta = addr - labelAddr;
    if (maxDelta !== undefined && delta > maxDelta) {
        return undefined;
    }
    return { name: t.byAddr.get(labelAddr)![0], addr: labelAddr, delta };
}

/** Format a resolved address as `name` or `name+N` (N in hex). */
export function formatResolved(r: ResolvedAddr): string {
    return r.delta === 0 ? r.name : `${r.name}+${r.delta.toString(16)}`;
}

// --- C source-level mapping (the `; @cline N` join) ----------------------------

export interface CSource { file: string; line: number; }

export interface CLineMap {
    /** PC → C source (file, line). */
    addrToSource: Map<number, CSource>;
    /** sorted PC keys of addrToSource (for nearest-preceding lookup). */
    sortedAddrs: number[];
    /** `file:line` → lowest PC for that C line (breakpoint target). */
    sourceToAddr: Map<string, number>;
    /** file → ascending [{line, addr}] (lowest PC per C line); for breakpoint binding. */
    linesByFile: Map<string, { line: number; addr: number }[]>;
}

/** Extract `; @cline N` markers from generated asm → ascending [{asmLine, cLine}]. */
function clineMarkers(text: string): { asmLine: number; cLine: number }[] {
    const out: { asmLine: number; cLine: number }[] = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/;\s*@cline\s+(\d+)/);
        if (m) {
            out.push({ asmLine: i + 1, cLine: parseInt(m[1], 10) }); // 1-based
        }
    }
    return out;
}

/** Largest `cLine` whose `asmLine <= target`, or undefined. */
function clineAtOrBefore(markers: { asmLine: number; cLine: number }[], target: number): number | undefined {
    let lo = 0, hi = markers.length - 1, best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (markers[mid].asmLine <= target) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return best < 0 ? undefined : markers[best].cLine;
}

/**
 * Join the `.sym` addr-to-line table (PC → generated-asm:line) with the
 * `; @cline N` markers in those asm files (asm:line → C:line) to get PC ↔ C
 * source. `asmTexts` maps each source filename from `[source files v2]` (e.g.
 * `main.c.wrap.asm`) to its text. Only files carrying `@cline` markers (the
 * C-derived ones) contribute; hand-written `.asm` are skipped.
 */
export function buildCLineMap(sym: SymTable, asmTexts: Map<string, string>): CLineMap {
    const addrToSource = new Map<number, CSource>();
    const sourceToAddr = new Map<string, number>();
    const cache = new Map<string, { asmLine: number; cLine: number }[]>();

    for (const e of sym.lineMap) {
        const fname = sym.sourceFiles.get(e.fileKey);
        if (!fname) {
            continue;
        }
        let markers = cache.get(fname);
        if (!markers) {
            const text = asmTexts.get(fname);
            markers = text ? clineMarkers(text) : [];
            cache.set(fname, markers);
        }
        if (markers.length === 0) {
            continue; // hand-written asm (no C lines)
        }
        const cLine = clineAtOrBefore(markers, e.asmLine);
        if (cLine === undefined) {
            continue;
        }
        // main.c.wrap.asm → main.c (the original C source)
        const cFile = fname.replace(/\.wrap\.asm$/, '').replace(/\.asm$/, '');
        addrToSource.set(e.addr, { file: cFile, line: cLine });
        const key = `${cFile}:${cLine}`;
        const prev = sourceToAddr.get(key);
        if (prev === undefined || e.addr < prev) {
            sourceToAddr.set(key, e.addr);
        }
    }
    const linesByFile = new Map<string, { line: number; addr: number }[]>();
    for (const [key, addr] of sourceToAddr) {
        const idx = key.lastIndexOf(':');
        const file = key.slice(0, idx);
        const line = parseInt(key.slice(idx + 1), 10);
        const arr = linesByFile.get(file) ?? linesByFile.set(file, []).get(file)!;
        arr.push({ line, addr });
    }
    for (const arr of linesByFile.values()) {
        arr.sort((a, b) => a.line - b.line);
    }
    return { addrToSource, sortedAddrs: [...addrToSource.keys()].sort((a, b) => a - b), sourceToAddr, linesByFile };
}

/**
 * Resolve a source breakpoint `(file, line)` to the actual bound line + PC: the
 * first C line at-or-after the requested one that has code. Returns undefined if
 * the file has no mapping or no line at/after `line`.
 */
export function resolveLine(map: CLineMap, file: string, line: number): { line: number; addr: number } | undefined {
    const arr = map.linesByFile.get(file);
    if (!arr) {
        return undefined;
    }
    for (const e of arr) {
        if (e.line >= line) {
            return e;
        }
    }
    return undefined;
}

/** PC → C source, using nearest-preceding (the stopped PC may sit between entries). */
export function cSourceForAddr(map: CLineMap, addr: number): CSource | undefined {
    const a = map.sortedAddrs;
    let lo = 0, hi = a.length - 1, best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (a[mid] <= addr) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return best < 0 ? undefined : map.addrToSource.get(a[best]);
}

// --- typed locals (the `; @dbglocal` join, G4) ---------------------------------

export interface LocalVar {
    /** C identifier. */
    name: string;
    /** class: u/s = unsigned/signed int, p = pointer, a = array, g = struct/union, f = float, v = other. */
    cls: string;
    /** size in bytes (exact C type size). */
    size: number;
    /** byte offset from the stack frame base (address = frameBase + offset, bank 0). */
    offset: number;
}

/**
 * Parse `; @dbglocal <class><bytes>_<name>.<id> <offset>` markers (emitted by the
 * patched cproc/QBE under `-g`), scoped by the `; Function: NAME` banners, into a
 * per-function list of typed locals. Present only in source-level (`-g`) builds.
 */
export function parseLocals(asmText: string): Map<string, LocalVar[]> {
    const out = new Map<string, LocalVar[]>();
    let fn = '';
    for (const raw of asmText.split(/\r?\n/)) {
        const f = raw.match(/^;\s*Function:\s*(\S+)/);
        if (f) {
            fn = f[1];
            continue;
        }
        const m = raw.match(/^;\s*@dbglocal\s+([uspagfv])(\d+)_(.+)\.\d+\s+(\d+)\s*$/);
        if (m && fn) {
            const arr = out.get(fn) ?? out.set(fn, []).get(fn)!;
            arr.push({ name: m[3], cls: m[1], size: parseInt(m[2], 10), offset: parseInt(m[4], 10) });
        }
    }
    return out;
}

export interface FuncRange { addr: number; name: string; }

/** All function names from the `; Function: NAME` banners, in order. */
export function parseFunctions(asmText: string): string[] {
    const out: string[] = [];
    for (const raw of asmText.split(/\r?\n/)) {
        const f = raw.match(/^;\s*Function:\s*(\S+)/);
        if (f) {
            out.push(f[1]);
        }
    }
    return out;
}

/**
 * Sorted entry addresses of the real C functions. Needed because the `.sym` has
 * many non-function labels (string constants, QBE block labels) interleaved, so
 * the nearest-preceding label is NOT reliably the enclosing function — but the
 * nearest-preceding *function entry* is.
 */
export function buildFuncRanges(sym: SymTable, names: string[]): FuncRange[] {
    const r: FuncRange[] = [];
    for (const n of names) {
        const a = sym.byName.get(n);
        if (a !== undefined) {
            r.push({ addr: a, name: n });
        }
    }
    return r.sort((x, y) => x.addr - y.addr);
}

// --- aggregate layouts (the `.dbg` sidecar, for struct/array expansion) --------

export type AggNode =
    | { kind: 'scalar'; cls: string; size: number }
    | { kind: 'array'; size: number; elem: AggNode; count: number }
    | { kind: 'struct'; size: number; fields: { name: string; off: number; type: AggNode }[] };

/** Recursive-descent parse of the compact type grammar written by cproc:
 *  scalar `u2`/`s2`/`p4`/`f4`, array `a<size>[<elem>;<count>]`,
 *  struct `g<size>{name:<type>@off;...}`. Returns [node, nextIndex]. */
function parseAggType(s: string, i: number): [AggNode, number] {
    const cls = s[i++];
    let num = '';
    while (i < s.length && s[i] >= '0' && s[i] <= '9') {
        num += s[i++];
    }
    const size = parseInt(num, 10);
    if (cls === 'a') {
        i++; // '['
        const [elem, j] = parseAggType(s, i);
        i = j + 1; // skip ';'
        let c = '';
        while (s[i] >= '0' && s[i] <= '9') {
            c += s[i++];
        }
        i++; // ']'
        return [{ kind: 'array', size, elem, count: parseInt(c, 10) }, i];
    }
    if (cls === 'g') {
        i++; // '{'
        const fields: { name: string; off: number; type: AggNode }[] = [];
        while (s[i] !== '}' && i < s.length) {
            let name = '';
            while (s[i] !== ':') {
                name += s[i++];
            }
            i++; // ':'
            const [ft, j] = parseAggType(s, i);
            i = j + 1; // skip '@'
            let off = '';
            while (s[i] >= '0' && s[i] <= '9') {
                off += s[i++];
            }
            i++; // ';'
            fields.push({ name, off: parseInt(off, 10), type: ft });
        }
        i++; // '}'
        return [{ kind: 'struct', size, fields }, i];
    }
    return [{ kind: 'scalar', cls, size }, i];
}

/** Parse the `.dbg` sidecar (`loc <func> <name> <type>` lines) into a map keyed
 *  by `func\0localname` → the aggregate's type tree. */
export function parseAggregates(dbgText: string): Map<string, AggNode> {
    const out = new Map<string, AggNode>();
    for (const raw of dbgText.split(/\r?\n/)) {
        const m = raw.match(/^loc (\S+) (\S+) (.+)$/);
        if (m) {
            try {
                out.set(`${m[1]} ${m[2]}`, parseAggType(m[3], 0)[0]);
            } catch { /* skip malformed */ }
        }
    }
    return out;
}

/** The C function enclosing a PC (nearest-preceding function entry). */
export function enclosingFunction(ranges: FuncRange[], pc: number): string | undefined {
    let lo = 0, hi = ranges.length - 1, best = -1;
    while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (ranges[mid].addr <= pc) {
            best = mid;
            lo = mid + 1;
        } else {
            hi = mid - 1;
        }
    }
    return best < 0 ? undefined : ranges[best].name;
}
