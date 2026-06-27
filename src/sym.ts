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
    /** 24-bit address. */
    addr: number;
    fileId: number;
    line: number;
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
    /** Present only when the build emitted addr-to-line data (G0); else empty. */
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
                // addr-to-line mapping v2:
                //   ROMOFF BB:AAAA SLOT FILEID:SRC:LINE   (when -A/-i are on)
                if (section.startsWith('addr-to-line')) {
                    const parts = line.split(/\s+/);
                    const ba = parts[1] ? parseBankAddr(parts[1]) : null;
                    const tail = parts[3]; // FILEID:SRC:LINE
                    if (ba && tail) {
                        const f = tail.split(':');
                        if (f.length === 3) {
                            t.lineMap.push({ addr: ba.addr, fileId: parseInt(f[0], 16), line: parseInt(f[2], 16) });
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
