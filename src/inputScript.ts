// Pure input-script parsing/formatting — no `vscode` import, Node-testable.
//
// The script format is luna's own `--input` checkpoint format (`frame:mask,…`,
// parse_input_script in luna-cli): a checkpoint's joypad mask HOLDS until the
// next checkpoint. Cooper additionally accepts button NAMES in place of the
// hex mask (`120:Start`, `180:A+Right`, `240:0` to release), and always emits
// canonical hex so scripts stay luna-CLI compatible.
//
// JOY1 bit layout (high → low, grounded in luna's SetJoypadParams):
// B, Y, Select, Start, Up, Down, Left, Right, A, X, L, R, 0, 0, 0, 0.

export interface InputCheckpoint { frame: number; mask: number; }

export const BUTTON_BITS: Record<string, number> = {
    B: 0x8000, Y: 0x4000, SELECT: 0x2000, START: 0x1000,
    UP: 0x0800, DOWN: 0x0400, LEFT: 0x0200, RIGHT: 0x0100,
    A: 0x0080, X: 0x0040, L: 0x0020, R: 0x0010,
};

/** `"A+Right"` → mask; also accepts hex (`0x1000`/`1000`) and `0`. */
export function buttonsToMask(spec: string): number {
    const s = spec.trim();
    if (/^(0x)?[0-9a-fA-F]+$/.test(s)) {
        return parseInt(s, 16) & 0xFFF0;
    }
    let mask = 0;
    for (const part of s.split('+')) {
        const bit = BUTTON_BITS[part.trim().toUpperCase()];
        if (bit === undefined) {
            throw new Error(`unknown button '${part.trim()}' (use B Y Select Start Up Down Left Right A X L R, +-combined, or a hex mask)`);
        }
        mask |= bit;
    }
    return mask;
}

/** Human name for a mask, e.g. `0x1080` → `"Start+A"`; 0 → `"(released)"`. */
export function maskToButtons(mask: number): string {
    const names = Object.entries(BUTTON_BITS).filter(([, bit]) => mask & bit).map(([n]) => n);
    return names.length ? names.map((n) => n[0] + n.slice(1).toLowerCase()).join('+') : '(released)';
}

/**
 * Parse `frame:mask` checkpoints (luna semantics: decimal frame, hex mask —
 * Cooper also accepts button names). Returns checkpoints sorted by frame.
 */
export function parseInputScript(script: string): InputCheckpoint[] {
    const out: InputCheckpoint[] = [];
    for (const entry of script.split(',')) {
        const e = entry.trim();
        if (!e) {
            continue;
        }
        const colon = e.indexOf(':');
        if (colon < 0) {
            throw new Error(`missing ':' in entry '${e}'`);
        }
        const frame = Number(e.slice(0, colon).trim());
        if (!Number.isInteger(frame) || frame < 0) {
            throw new Error(`bad frame number in '${e}'`);
        }
        out.push({ frame, mask: buttonsToMask(e.slice(colon + 1)) });
    }
    return out.sort((a, b) => a.frame - b.frame);
}

/** Canonical luna-CLI-compatible text for checkpoints. */
export function formatInputScript(checkpoints: InputCheckpoint[]): string {
    return checkpoints.map((c) => `${c.frame}:0x${c.mask.toString(16).toUpperCase().padStart(4, '0')}`).join(',');
}

/** Canonicalize a user-entered script for storage (validate + canonical hex). */
export function canonicalScript(script: string): string {
    return formatInputScript(parseInputScript(script));
}

/**
 * Parse a luna-gui `.input` recording FILE (issue #83): `#` comment lines
 * (including the commented `# player 2` line, which is not `--input`-replayable)
 * are dropped; the remaining Player-1 checkpoint lines are joined and parsed.
 * Same result as `parseInputScript` on the P1 script, so a recording round-trips
 * straight into Cooper's replay + gameplay-test paths.
 */
export function parseInputFile(text: string): InputCheckpoint[] {
    const script = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('#'))
        .join(',');
    return parseInputScript(script);
}
