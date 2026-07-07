// Pure SNES ROM validation — no `vscode` import, Node-testable.
//
// Reads the internal cartridge header (LoROM $7FC0 / HiROM $FFC0, auto-scored),
// recomputes the checksum (power-of-two sum, or largest-power-of-two + mirrored
// remainder — validated against real wlalink-built SDK ROMs), and reports the
// pass/fail items that matter before putting a ROM on hardware.

export interface RomCheckItem { label: string; ok: boolean; detail: string; }

export interface RomReport {
    mapping: 'LoROM' | 'HiROM' | 'unknown';
    title: string;
    mapMode: number;
    sizeKb: number;
    headerSizeKb: number;
    version: number;
    copierHeader: boolean;
    items: RomCheckItem[];
    ok: boolean;
}

const hex16 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;

/** SNES checksum: plain 16-bit sum for power-of-two sizes; otherwise the
 *  largest power-of-two part + the remainder repeated to fill it. */
export function snesChecksum(rom: Uint8Array): number {
    let sum = 0;
    const n = rom.length;
    if ((n & (n - 1)) === 0) {
        for (let i = 0; i < n; i++) {
            sum += rom[i];
        }
        return sum & 0xFFFF;
    }
    const p = 1 << (31 - Math.clz32(n));
    const rem = n - p;
    let sumP = 0, sumR = 0;
    for (let i = 0; i < p; i++) {
        sumP += rom[i];
    }
    for (let i = p; i < n; i++) {
        sumR += rom[i];
    }
    return (sumP + sumR * Math.floor(p / rem)) & 0xFFFF;
}

function headerScore(rom: Uint8Array, base: number, wantLo: boolean): number {
    if (base + 0x40 > rom.length) {
        return -1;
    }
    let score = 0;
    const comp = rom[base + 0x1C] | (rom[base + 0x1D] << 8);
    const cks = rom[base + 0x1E] | (rom[base + 0x1F] << 8);
    if ((comp ^ cks) === 0xFFFF) {
        score += 4;
    }
    const map = rom[base + 0x15];
    if ((map & 0x0F) === (wantLo ? 0x00 : 0x01) && (map & 0xE0) === 0x20) {
        score += 2;
    }
    let printable = 0;
    for (let i = 0; i < 21; i++) {
        const c = rom[base + i];
        if (c >= 0x20 && c < 0x7F) {
            printable++;
        }
    }
    if (printable === 21) {
        score += 1;
    }
    return score;
}

/** Validate a ROM image (the raw `.sfc`/`.smc` file bytes). */
export function checkRom(fileBytes: Uint8Array): RomReport {
    const copierHeader = fileBytes.length % 1024 === 512;
    const rom = copierHeader ? fileBytes.subarray(512) : fileBytes;

    const loScore = headerScore(rom, 0x7FC0, true);
    const hiScore = headerScore(rom, 0xFFC0, false);
    const mapping: RomReport['mapping'] = loScore < 0 && hiScore < 0 ? 'unknown'
        : loScore >= hiScore ? 'LoROM' : 'HiROM';
    const base = mapping === 'HiROM' ? 0xFFC0 : 0x7FC0;

    const items: RomCheckItem[] = [];
    const push = (label: string, ok: boolean, detail: string): void => {
        items.push({ label, ok, detail });
    };

    if (base + 0x40 > rom.length) {
        push('internal header present', false, `ROM too small (${rom.length} bytes) for a ${mapping} header`);
        return { mapping: 'unknown', title: '', mapMode: 0, sizeKb: Math.round(rom.length / 1024), headerSizeKb: 0, version: 0, copierHeader, items, ok: false };
    }

    const title = Array.from(rom.subarray(base, base + 21)).map((c) => (c >= 0x20 && c < 0x7F ? String.fromCharCode(c) : '·')).join('');
    const mapMode = rom[base + 0x15];
    const headerSizeKb = 1 << rom[base + 0x17];
    const version = rom[base + 0x1B];
    const comp = rom[base + 0x1C] | (rom[base + 0x1D] << 8);
    const cks = rom[base + 0x1E] | (rom[base + 0x1F] << 8);
    const computed = snesChecksum(rom);
    const resetVector = rom[base + 0x3C] | (rom[base + 0x3D] << 8);

    push('no copier header', !copierHeader, copierHeader
        ? '512-byte copier header found — most flashcarts want a clean .sfc'
        : 'clean image');
    push('title printable', /^[\x20-\x7E]{21}$/.test(Array.from(rom.subarray(base, base + 21)).map((c) => String.fromCharCode(c)).join('')), `"${title.trim()}"`);
    push('checksum ⊕ complement = $FFFF', (comp ^ cks) === 0xFFFF, `${hex16(cks)} ⊕ ${hex16(comp)}`);
    push('checksum matches the image', computed === cks, computed === cks ? hex16(cks) : `header ${hex16(cks)} ≠ computed ${hex16(computed)}`);
    push('header ROM size covers the image', (headerSizeKb * 1024) >= rom.length, `header ${headerSizeKb} KB · file ${Math.round(rom.length / 1024)} KB`);
    push('reset vector in ROM area', resetVector >= 0x8000, hex16(resetVector));

    return {
        mapping, title, mapMode, sizeKb: Math.round(rom.length / 1024), headerSizeKb, version, copierHeader,
        items, ok: items.every((i) => i.ok),
    };
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}

/** Render the validation report (static — pair with `enableScripts: false`). */
export function renderRomCheckHtml(name: string, r: RomReport, cspSource: string): string {
    const rows = r.items.map((i) =>
        `<tr class="${i.ok ? 'ok' : 'bad'}"><td>${i.ok ? '✓' : '✗'}</td><td>${escapeHtml(i.label)}</td><td>${escapeHtml(i.detail)}</td></tr>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline';">
<style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 10px; font-size: 12px; }
  h3 { margin: 0 0 2px; font-size: 13px; }
  .sub { color: var(--vscode-descriptionForeground); margin: 0 0 10px; }
  table { border-collapse: collapse; }
  td { padding: 2px 10px 2px 0; }
  tr.ok td:first-child { color: var(--vscode-testing-iconPassed, #89d185); }
  tr.bad td:first-child { color: var(--vscode-errorForeground, #f66); font-weight: 700; }
  .verdict { margin-top: 10px; font-weight: 700; }
</style></head><body>
<h3>${escapeHtml(name)}</h3>
<p class="sub">${r.mapping} · "${escapeHtml(r.title.trim())}" · ${r.sizeKb} KB · map mode $${r.mapMode.toString(16).toUpperCase().padStart(2, '0')} · v1.${r.version}</p>
<table><tbody>${rows}</tbody></table>
<p class="verdict">${r.ok ? '✓ ready for hardware' : '✗ fix the items above before flashing'}</p>
</body></html>`;
}
