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
