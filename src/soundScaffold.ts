// Pure "Add Sound Effect" scaffolding — no `vscode` import, Node-testable.
//
// Kills dogfood #2 friction F11 (no `.it` authoring path): from a plain WAV a
// user authored anywhere, produce a spec-valid Impulse Tracker `.it` holding one
// sample, wire it into the soundbank + Makefile, and hand back the C snippet.
// Cooper owns the SNES bridge (sample → `.it` → soundbank + audition); the
// tracker itself stays external (architecture rule: integrate the commodity,
// own the differentiator). The `.it` layout here is the sample-only, one-pattern
// form proven to be accepted by the SDK's `smconv` (dogfood #2, 2026-07-08).

import { resampleMono, SNES_SAMPLE_RATE } from './wav';

/** Hard cap on a sound effect's length (samples @ 32 kHz ≈ 1.5 s); keeps well
 *  inside the SPC700's ~51 KB sample RAM once BRR-compressed. */
export const MAX_SFX_SAMPLES = 48000;

/** Effect symbol as `smconv` derives it from the sample name: upper-cased,
 *  non-alphanumerics → `_` (so `res/coin.wav` → `SFX_COIN`). */
export function sfxSymbol(name: string): string {
    const stem = (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '');
    const id = stem.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/^([0-9])/, '_$1');
    return `SFX_${id || 'FX'}`;
}

/** The IT sample name `smconv` reads (lower-cased stem, ≤ 25 chars). */
export function sampleName(name: string): string {
    const stem = (name.split(/[\\/]/).pop() ?? name).replace(/\.[^.]+$/, '');
    return (stem.replace(/[^A-Za-z0-9 ]/g, '').trim() || 'fx').slice(0, 25);
}

export interface BuiltIt {
    it: Buffer;
    sampleRate: number;
    sampleCount: number;
    truncated: boolean;
}

/**
 * Build a minimal, spec-valid `.it` from mono signed-16 PCM: one 16-bit sample
 * (sample-mode, no instruments) plus a single one-note pattern — exactly the
 * shape `smconv` accepts and turns into `SFX_<NAME>`. Samples above 32 kHz are
 * resampled down (the SPC700's native rate) and length is capped
 * (`MAX_SFX_SAMPLES`); `truncated` reports if the tail was dropped.
 */
export function buildIt(name: string, samples: number[], sampleRate: number): BuiltIt {
    let pcm = samples;
    let rate = sampleRate;
    if (rate > SNES_SAMPLE_RATE) {
        pcm = resampleMono(pcm, rate, SNES_SAMPLE_RATE);
        rate = SNES_SAMPLE_RATE;
    }
    const truncated = pcm.length > MAX_SFX_SAMPLES;
    if (truncated) {
        pcm = pcm.slice(0, MAX_SFX_SAMPLES);
    }
    const length = pcm.length;

    const HDR = 0xC0;
    const OrdNum = 2, InsNum = 0, SmpNum = 1, PatNum = 1;
    const smpHdrOff = HDR + OrdNum + 4 * SmpNum + 4 * PatNum;
    const patOff = smpHdrOff + 80;

    // pattern: note C5 (60) + sample 1 at row 0 ch 0, then 63 empty rows.
    const rows = Buffer.concat([Buffer.from([0x81, 0x03, 60, 1, 0x00]), Buffer.alloc(63, 0x00)]);
    const patHead = Buffer.alloc(8);
    patHead.writeUInt16LE(rows.length, 0);
    patHead.writeUInt16LE(64, 2);
    const patData = Buffer.concat([patHead, rows]);
    const smpPtr = patOff + patData.length;

    // sample header (80 bytes)
    const sh = Buffer.alloc(80);
    sh.write('IMPS', 0, 'ascii');
    sh.writeUInt8(64, 0x11);                     // global volume
    sh.writeUInt8(0x03, 0x12);                   // flags: sample associated + 16-bit
    sh.writeUInt8(64, 0x13);                     // default volume
    sh.write(sampleName(name), 0x14, 'ascii');   // -> SFX_<NAME>
    sh.writeUInt8(0x01, 0x2E);                   // Cvt: signed samples
    sh.writeUInt8(0x20, 0x2F);                   // default pan
    sh.writeUInt32LE(length, 0x30);              // length in samples
    sh.writeUInt32LE(rate, 0x3C);                // C5 speed
    sh.writeUInt32LE(smpPtr, 0x48);              // sample data pointer

    // header (0xC0 bytes)
    const H = Buffer.alloc(HDR);
    H.write('IMPM', 0, 'ascii');
    H.writeUInt8(0x04, 0x1E); H.writeUInt8(0x10, 0x1F);
    H.writeUInt16LE(OrdNum, 0x20);
    H.writeUInt16LE(InsNum, 0x22);
    H.writeUInt16LE(SmpNum, 0x24);
    H.writeUInt16LE(PatNum, 0x26);
    H.writeUInt16LE(0x0214, 0x28);               // Cwt
    H.writeUInt16LE(0x0214, 0x2A);               // Cmwt
    H.writeUInt16LE(0x0000, 0x2C);               // Flags: sample mode (no instruments)
    H.writeUInt8(128, 0x30);                     // global volume
    H.writeUInt8(48, 0x31);                      // mixing volume
    H.writeUInt8(6, 0x32);                       // initial speed
    H.writeUInt8(125, 0x33);                     // initial tempo
    H.writeUInt8(128, 0x34);                     // pan separation
    for (let i = 0; i < 64; i++) { H.writeUInt8(32, 0x40 + i); } // channel pan (center)
    for (let i = 0; i < 64; i++) { H.writeUInt8(64, 0x80 + i); } // channel volume

    const orders = Buffer.from([0, 255]);
    const offsets = Buffer.alloc(4 * SmpNum + 4 * PatNum);
    offsets.writeUInt32LE(smpHdrOff, 0);
    offsets.writeUInt32LE(patOff, 4);

    const pcmBuf = Buffer.alloc(length * 2);
    for (let i = 0; i < length; i++) {
        pcmBuf.writeInt16LE(Math.max(-32768, Math.min(32767, pcm[i] | 0)), i * 2);
    }

    const it = Buffer.concat([H, orders, offsets, sh, patData, pcmBuf]);
    return { it, sampleRate: rate, sampleCount: length, truncated };
}

/**
 * Wire a soundbank `.it` into a Makefile: ensure `USE_SNESMOD := 1` and add the
 * `.it` to `SOUNDBANK_SRC` (creating the line if needed). Idempotent.
 */
export function ensureSoundbank(makefile: string, itRel: string): string {
    let mk = makefile;

    if (!/^[ \t]*USE_SNESMOD[ \t]*:?=/m.test(mk)) {
        mk = mk.replace(/^([ \t]*include\s+\$\(OPENSNES\)\/make\/common\.mk.*)$/m, `USE_SNESMOD   := 1\n$1`);
    }

    const m = /^([ \t]*SOUNDBANK_SRC[ \t]*:?=[ \t]*)(.*)$/m.exec(mk);
    if (!m) {
        return mk.replace(/^([ \t]*include\s+\$\(OPENSNES\)\/make\/common\.mk.*)$/m, `SOUNDBANK_SRC := ${itRel}\n$1`);
    }
    const cur = m[2].trim().split(/\s+/).filter(Boolean);
    if (cur.includes(itRel)) {
        return mk;
    }
    return mk.replace(m[0], `${m[1]}${[...cur, itRel].join(' ')}`);
}

/** The C snippet: init the driver, load the effect, drive it, play on an event. */
export function sfxSnippet(symbol: string): string {
    const slot = 'sfx' + symbol.replace(/^SFX_/, '').split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join('');
    return `// --- ${symbol}: generated by Cooper (Add Sound Effect) ---\n`
        + `// 1) at the top of the file:\n`
        + `#include <snes/snesmod.h>\n`
        + `#include "soundbank.h"\n\n`
        + `// 2) in main(), after the first WaitForVBlank and before setScreenOn:\n`
        + `//    (snesmodInit uploads the SPC driver — it costs a few frames, so do\n`
        + `//     it once here, never inside the game loop.)\n`
        + `snesmodInit();\n`
        + `snesmodSetSoundbank(SOUNDBANK_BANK);\n`
        + `u8 ${slot} = snesmodLoadEffect(${symbol});\n\n`
        + `// 3) once per frame in your loop:\n`
        + `snesmodProcess();\n\n`
        + `// 4) when the event happens:\n`
        + `snesmodPlayEffect(${slot}, 127, 128, SNESMOD_PITCH_NORMAL);\n`;
}
