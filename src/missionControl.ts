// Pure "Mission Control" logic — no `vscode` import, Node-testable. UX-2 (D-080).
//
// Two brains: the permanent status-bar text (the studio's heartbeat, always
// visible), and the dashboard's "next step" suggestion — the thing that makes
// Cooper feel like a game studio guiding you, not a pile of commands.

export interface StudioState {
    projectName: string | null;
    romBuilt: boolean;
    lunaFound: boolean;
    watchOn: boolean;
    /** project has at least one indexed PNG under res/ (art exists). */
    hasArt: boolean;
    /** project has a soundbank source (sfx/*.it or SOUNDBANK_SRC). */
    hasSound: boolean;
    /** project has gameplay tests (test/manifest.toml). */
    hasTests: boolean;
    /** project has AGENTS.md (AI configured). */
    hasAi: boolean;
}

/** The permanent status-bar item: `$(game) <name> · ✓/…` (click = dashboard). */
export function statusBarText(s: StudioState): { text: string; tooltip: string } {
    if (!s.projectName) {
        return { text: '$(game) Cooper', tooltip: 'Cooper — no project open. Click for the dashboard (New Game lives there).' };
    }
    const bits = [s.romBuilt ? '$(pass-filled)' : '$(circle-large-outline)'];
    if (s.watchOn) {
        bits.push('$(eye)');
    }
    if (!s.lunaFound) {
        bits.push('$(warning)');
    }
    return {
        text: `$(game) ${s.projectName} ${bits.join(' ')}`,
        tooltip: `Cooper — ${s.projectName}\nROM: ${s.romBuilt ? 'built ✓' : 'not built yet'}`
            + `${s.watchOn ? '\nWatch: rebuilding on save' : ''}`
            + `${s.lunaFound ? '' : '\n⚠ luna not found (set cooper.lunaPath)'}`
            + '\nClick to open the dashboard.',
    };
}

export interface NextStep { label: string; cmd: string; hint: string; }

/**
 * The dashboard's suggested next step — one at a time, in the order a game
 * actually comes together. This is the guided 90% path made ambient: the
 * dashboard always tells you what would move your game forward.
 */
export function nextStep(s: StudioState): NextStep {
    if (!s.projectName) {
        return { label: '🎮 New Game…', cmd: 'newgame', hint: 'Start here — pick a genre and Cooper builds you a playable starter.' };
    }
    if (!s.romBuilt) {
        return { label: '▶ Build', cmd: 'build', hint: 'Build the ROM first — then Run shows you the game.' };
    }
    if (!s.hasArt) {
        return { label: '✏️ New Sprite…', cmd: 'newsprite', hint: 'Give your game its own art — draw a sprite, then Add Sprite wires it in.' };
    }
    if (!s.hasSound) {
        return { label: '🔊 Add Sound Effect…', cmd: 'addsound', hint: 'A game needs feedback — drop in a WAV and Cooper wires the soundbank.' };
    }
    if (!s.hasTests) {
        return { label: '🧪 Record a Gameplay Test…', cmd: 'rectest', hint: 'Lock in what works — a deterministic replay that catches regressions.' };
    }
    if (!s.hasAi) {
        return { label: '🤖 Configure AI', cmd: 'configai', hint: 'Make your AI assistant OpenSNES-fluent — it can verify its code on real hardware.' };
    }
    return { label: '🚀 Validate ROM', cmd: 'validate', hint: 'Everything is in place — check the header and ship it to a flashcart.' };
}
