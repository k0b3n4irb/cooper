// Pure RIFF/WAVE PCM16 encoder — no `vscode` import, Node-testable.
// Input: interleaved stereo samples [l0, r0, l1, r1, …] as signed 16-bit
// values, the exact shape luna's `drain_audio` returns (32 kHz — the SPC700's
// native output rate).

export const SNES_SAMPLE_RATE = 32000;

export function encodeWav(samples: number[], sampleRate = SNES_SAMPLE_RATE): Buffer {
    const channels = 2;
    const bytesPerSample = 2;
    const dataSize = samples.length * bytesPerSample;
    const buf = Buffer.alloc(44 + dataSize);
    buf.write('RIFF', 0, 'ascii');
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write('WAVE', 8, 'ascii');
    buf.write('fmt ', 12, 'ascii');
    buf.writeUInt32LE(16, 16);                       // PCM chunk size
    buf.writeUInt16LE(1, 20);                        // PCM
    buf.writeUInt16LE(channels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(sampleRate * channels * bytesPerSample, 28); // byte rate
    buf.writeUInt16LE(channels * bytesPerSample, 32);              // block align
    buf.writeUInt16LE(16, 34);                       // bits per sample
    buf.write('data', 36, 'ascii');
    buf.writeUInt32LE(dataSize, 40);
    for (let i = 0; i < samples.length; i++) {
        buf.writeInt16LE(Math.max(-32768, Math.min(32767, samples[i] | 0)), 44 + i * 2);
    }
    return buf;
}

export interface DecodedWav {
    /** Mono, signed 16-bit samples (stereo is downmixed by averaging). */
    samples: number[];
    sampleRate: number;
    channels: number;
}

/**
 * Minimal RIFF/WAVE PCM decoder — parses uncompressed PCM (8-bit unsigned or
 * 16-bit signed, mono or stereo) into mono signed-16 samples. Enough to ingest a
 * sound effect exported from any editor; not a general WAV reader (no float, no
 * ADPCM). Throws on anything it can't read.
 */
export function decodeWav(buf: Buffer): DecodedWav {
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('not a RIFF/WAVE file');
    }
    let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number } | undefined;
    let dataOff = -1;
    let dataLen = 0;
    let off = 12;
    while (off + 8 <= buf.length) {
        const id = buf.toString('ascii', off, off + 4);
        const size = buf.readUInt32LE(off + 4);
        const body = off + 8;
        if (id === 'fmt ') {
            fmt = {
                audioFormat: buf.readUInt16LE(body),
                channels: buf.readUInt16LE(body + 2),
                sampleRate: buf.readUInt32LE(body + 4),
                bitsPerSample: buf.readUInt16LE(body + 14),
            };
        } else if (id === 'data') {
            dataOff = body;
            dataLen = Math.min(size, buf.length - body);
        }
        off = body + size + (size & 1); // chunks are word-aligned
    }
    if (!fmt || dataOff < 0) {
        throw new Error('missing fmt/data chunk');
    }
    if (fmt.audioFormat !== 1) {
        throw new Error(`unsupported WAV format ${fmt.audioFormat} (only uncompressed PCM)`);
    }
    if (fmt.bitsPerSample !== 8 && fmt.bitsPerSample !== 16) {
        throw new Error(`unsupported bit depth ${fmt.bitsPerSample} (only 8/16-bit PCM)`);
    }
    const ch = fmt.channels || 1;
    const bytesPer = fmt.bitsPerSample / 8;
    const frameBytes = bytesPer * ch;
    const frames = Math.floor(dataLen / frameBytes);
    const out: number[] = [];
    for (let f = 0; f < frames; f++) {
        let acc = 0;
        for (let c = 0; c < ch; c++) {
            const p = dataOff + f * frameBytes + c * bytesPer;
            acc += fmt.bitsPerSample === 8 ? (buf.readUInt8(p) - 128) << 8 : buf.readInt16LE(p);
        }
        out.push(Math.max(-32768, Math.min(32767, Math.round(acc / ch))));
    }
    return { samples: out, sampleRate: fmt.sampleRate, channels: ch };
}

/** Linear-resample mono signed-16 samples to a new rate (used to fit ≤32 kHz). */
export function resampleMono(samples: number[], fromRate: number, toRate: number): number[] {
    if (fromRate === toRate || samples.length === 0) {
        return samples.slice();
    }
    const ratio = toRate / fromRate;
    const n = Math.max(1, Math.round(samples.length * ratio));
    const out: number[] = new Array(n);
    for (let i = 0; i < n; i++) {
        const src = i / ratio;
        const i0 = Math.floor(src);
        const i1 = Math.min(samples.length - 1, i0 + 1);
        const t = src - i0;
        out[i] = Math.round(samples[i0] * (1 - t) + samples[i1] * t);
    }
    return out;
}

/** Fraction of samples that are non-zero — a "did the game make sound?" probe. */
export function nonSilentRatio(samples: number[]): number {
    if (!samples.length) {
        return 0;
    }
    let n = 0;
    for (const s of samples) {
        if (s !== 0) {
            n++;
        }
    }
    return n / samples.length;
}
