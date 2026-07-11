// Pure SFX synthesizer — no `vscode` import, Node-testable, fully deterministic
// (no Math.random / Date: noise uses a seeded xorshift). The "New Sprite of
// sound" (D-081): sfxr-style presets + a few parameters → mono signed-16 PCM at
// the SNES's native 32 kHz, feeding the existing Add Sound pipeline
// (WAV → `.it` → soundbank). The WAV stays the source of truth.

import { SNES_SAMPLE_RATE } from './wav';

export type Wave = 'square' | 'triangle' | 'saw' | 'sine' | 'noise';

export interface SfxParams {
    wave: Wave;
    /** Base frequency in Hz at t=0 (20..4000 useful). */
    baseFreq: number;
    /** Frequency slide in octaves/second (+rises, −falls). */
    freqSlide: number;
    /** Square duty cycle 0.1..0.9 (square only). */
    duty: number;
    /** Attack time in seconds (linear ramp in). */
    attack: number;
    /** Decay time constant in seconds (exponential fade after attack). */
    decay: number;
    /** Total duration in seconds (0.03..1.5 — SPC RAM is small). */
    duration: number;
    /** Vibrato depth in semitones (0 = none). */
    vibratoDepth: number;
    /** Vibrato speed in Hz. */
    vibratoSpeed: number;
    /** Arpeggio: multiply the frequency by `mult` from `at` (fraction of duration). */
    arp?: { at: number; mult: number };
    /** Output volume 0..1. */
    volume: number;
}

/** Classic game-feel presets (tuned by ear; locked by tests for non-silence). */
export const SFX_PRESETS: Record<string, SfxParams> = {
    coin: { wave: 'square', baseFreq: 1047, freqSlide: 0, duty: 0.5, attack: 0.002, decay: 0.12, duration: 0.28, vibratoDepth: 0, vibratoSpeed: 0, arp: { at: 0.25, mult: 1.5 }, volume: 0.7 },
    jump: { wave: 'square', baseFreq: 330, freqSlide: 2.5, duty: 0.3, attack: 0.004, decay: 0.2, duration: 0.3, vibratoDepth: 0, vibratoSpeed: 0, volume: 0.7 },
    laser: { wave: 'saw', baseFreq: 1800, freqSlide: -6, duty: 0.5, attack: 0.001, decay: 0.15, duration: 0.22, vibratoDepth: 0, vibratoSpeed: 0, volume: 0.65 },
    hit: { wave: 'noise', baseFreq: 900, freqSlide: -5, duty: 0.5, attack: 0.001, decay: 0.08, duration: 0.18, vibratoDepth: 0, vibratoSpeed: 0, volume: 0.75 },
    explosion: { wave: 'noise', baseFreq: 140, freqSlide: -1, duty: 0.5, attack: 0.005, decay: 0.4, duration: 0.8, vibratoDepth: 0, vibratoSpeed: 0, volume: 0.85 },
    powerup: { wave: 'triangle', baseFreq: 440, freqSlide: 3, duty: 0.5, attack: 0.01, decay: 0.25, duration: 0.5, vibratoDepth: 0.6, vibratoSpeed: 9, volume: 0.75 },
    blip: { wave: 'square', baseFreq: 700, freqSlide: 0, duty: 0.5, attack: 0.001, decay: 0.04, duration: 0.07, vibratoDepth: 0, vibratoSpeed: 0, volume: 0.6 },
};

/** Clamp params into their sane/SPC-safe ranges (the UI can send anything). */
export function clampParams(p: SfxParams): SfxParams {
    const c = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
    return {
        wave: (['square', 'triangle', 'saw', 'sine', 'noise'] as Wave[]).includes(p.wave) ? p.wave : 'square',
        baseFreq: c(p.baseFreq, 20, 4000),
        freqSlide: c(p.freqSlide, -8, 8),
        duty: c(p.duty, 0.1, 0.9),
        attack: c(p.attack, 0, 0.5),
        decay: c(p.decay, 0.01, 1),
        duration: c(p.duration, 0.03, 1.5),
        vibratoDepth: c(p.vibratoDepth, 0, 4),
        vibratoSpeed: c(p.vibratoSpeed, 0, 20),
        arp: p.arp ? { at: c(p.arp.at, 0, 1), mult: c(p.arp.mult, 0.25, 4) } : undefined,
        volume: c(p.volume, 0, 1),
    };
}

/**
 * Render the sound: mono signed-16 samples at 32 kHz. Deterministic — same
 * params, same bytes (noise is a fixed-seed xorshift stepped per waveform
 * cycle, the retro "pitched noise" feel).
 */
export function synthesize(params: SfxParams, sampleRate = SNES_SAMPLE_RATE): number[] {
    const p = clampParams(params);
    const n = Math.floor(p.duration * sampleRate);
    const out: number[] = new Array(n);
    let phase = 0;
    let noiseSeed = 0x2F6E2B1 >>> 0;   // fixed seed — determinism
    let noiseVal = 0;
    const nextNoise = (): number => {
        noiseSeed ^= noiseSeed << 13; noiseSeed >>>= 0;
        noiseSeed ^= noiseSeed >> 17;
        noiseSeed ^= noiseSeed << 5; noiseSeed >>>= 0;
        return (noiseSeed / 0xFFFFFFFF) * 2 - 1;
    };
    for (let i = 0; i < n; i++) {
        const t = i / sampleRate;
        // frequency: slide (octaves/s) × arpeggio × vibrato
        let f = p.baseFreq * Math.pow(2, p.freqSlide * t);
        if (p.arp && t >= p.arp.at * p.duration) {
            f *= p.arp.mult;
        }
        if (p.vibratoDepth > 0) {
            f *= Math.pow(2, (p.vibratoDepth / 12) * Math.sin(2 * Math.PI * p.vibratoSpeed * t));
        }
        const prev = phase;
        phase += f / sampleRate;
        if (p.wave === 'noise' && Math.floor(phase) !== Math.floor(prev)) {
            noiseVal = nextNoise();          // new value each cycle → pitched noise
        }
        const ph = phase - Math.floor(phase);
        let s: number;
        switch (p.wave) {
            case 'square': s = ph < p.duty ? 1 : -1; break;
            case 'saw': s = 2 * ph - 1; break;
            case 'triangle': s = ph < 0.5 ? 4 * ph - 1 : 3 - 4 * ph; break;
            case 'sine': s = Math.sin(2 * Math.PI * ph); break;
            case 'noise': s = noiseVal; break;
        }
        // envelope: linear attack, then exponential decay
        const env = (p.attack > 0 && t < p.attack)
            ? t / p.attack
            : Math.exp(-(t - p.attack) / p.decay);
        const v = s * env * p.volume;
        out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
    }
    return out;
}
