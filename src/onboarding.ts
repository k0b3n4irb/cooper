// Pure onboarding helpers — no `vscode` import, Node-testable.
//
// Grounded in the OpenSNES release CI (.github/workflows/release.yml): every
// `v*` tag publishes one zip per platform, named
// `opensnes_<version>_<os>_<arch>.zip` for linux x86_64 / linux arm64 /
// windows x86_64 / darwin arm64. luna releases follow the same per-arch shape.

/** The release asset tag for this host (`linux_arm64`…), or null if the
 *  platform has no prebuilt release (→ build from source, the contributor path). */
export function releaseArchTag(platform: string, arch: string): string | null {
    const os = platform === 'linux' ? 'linux'
        : platform === 'darwin' ? 'darwin'
            : platform === 'win32' ? 'windows' : null;
    const cpu = arch === 'x64' ? 'x86_64' : arch === 'arm64' ? 'arm64' : null;
    if (!os || !cpu) {
        return null;
    }
    const available = new Set(['linux_x86_64', 'linux_arm64', 'windows_x86_64', 'darwin_arm64']);
    const tag = `${os}_${cpu}`;
    return available.has(tag) ? tag : null;
}

export const OPENSNES_RELEASES_URL = 'https://github.com/k0b3n4irb/opensnes/releases/latest';
export const LUNA_RELEASES_URL = 'https://github.com/k0b3n4irb/luna/releases/latest';

/**
 * Whether an installed SDK's `cc65816` carries the Cooper debug-info gate
 * (OpenSNES ≥ 0.26: `CC65816_G` env → `-g`/`.dbg` sidecar). Pass the wrapper
 * script's text; without the gate, source-level C debugging falls back to the
 * symbol level.
 */
export function sdkSupportsDebugInfo(cc65816Text: string): boolean {
    return /CC65816_G/.test(cc65816Text);
}
