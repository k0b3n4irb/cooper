# Cooper — User Guide

Cooper is a VS Code extension that turns VS Code into an **IDE for making SNES
games** with the OpenSNES SDK and the luna emulator: C support, one-click build &
run, and a real **debugger** (breakpoints, registers, memory, live PPU viewers).

> Status: this guide tracks the shipped extension (v0.12.x). Sections marked
> **(coming)** are not implemented yet.

---

## 1. Prerequisites

Cooper orchestrates tools it does **not** bundle — install them once:

| Tool | What it is | How Cooper finds it |
|---|---|---|
| **OpenSNES SDK** | the libraries + `make` rules + `cc65816` compiler | setting `cooper.opensnesPath`, else the project Makefile, else a parent search |
| **luna** | the SNES emulator (run / preview / debug backend) | setting `cooper.lunaPath`, else the SDK's bundled binary, else `luna` on your PATH |
| **clangd** | the C language server (completion, hover, go-to-definition) | the bundled *clangd* VS Code extension downloads it in one click |

**Key idea — your project is separate from the SDK.** Your game lives in *its own
folder* (just your `.c`, assets, and a Makefile). OpenSNES and luna are installed
elsewhere as *user releases*. Point Cooper at them once:

```jsonc
// .vscode/settings.json  (or your global VS Code settings)
{
  "cooper.opensnesPath": "/path/to/opensnes",
  "cooper.lunaPath": "/path/to/luna"   // the binary OR the folder containing it
}
```

> `cooper.lunaPath` accepts either the `luna` binary or the folder it unzips into
> (which also contains `luna-gui`). If you leave it empty, Cooper looks for the
> SDK's bundled binary, then `luna` on your PATH.

---

> **In a hurry?** After installing, run **Cooper: Get Started** (or click the 🎓 in
> the Cooper panel header) for an interactive, in-editor walkthrough that does
> everything below, step by step.

## 2. Install Cooper

Install the `.vsix` (`code --install-extension cooper-x.y.z.vsix`) or from the
Marketplace **(coming)**. Cooper bundles the **clangd** extension; when it prompts
*"clangd is not installed"*, click **Install** (or run `clangd: Download language
server`) — one click, no terminal.

---

## 3. The Cooper sidebar

Click the **Cooper** icon (a gamepad) in the activity bar. Everything is one click —
no commands to memorize.

![The Cooper sidebar](images/sidebar.png)

- **PROJECT** — your ROM (with a *built* badge) and the detected SDK.
- **BUILD & RUN** — Build, Run / Preview, Debug.
- **PPU VIEWERS** — Palette, Sprites, Tiles (live, at a debug stop).
- **SYMBOLS** — *your* functions (parsed from your `.c` and matched to the `.sym`).
  **Click one to toggle a breakpoint on it.**

The **🏠** and **↻** buttons in the panel header open the dashboard and refresh.

## 4. The dashboard ("Home")

Click **🏠** for a graphical home: big Build / Run / Debug buttons, a live preview
thumbnail, and PPU viewer cards.

![The Cooper dashboard](images/dashboard.png)

---

## 5. Build

Click **Build** (sidebar or dashboard). Cooper runs `make` **in your project
folder** and passes `OPENSNES=<your SDK>`, so the build works even though your
project lives outside the SDK tree. Compiler errors appear in the **Problems**
panel (click to jump to the line).

> If you see `…/make/common.mk: No such file or directory`, set `cooper.opensnesPath`
> to your OpenSNES release.

## 6. Run / Preview

Click **Run**. Cooper renders a frame in luna and shows it inline.

![A rendered frame](images/preview.png)

Tune it with `cooper.preview.steps` (how long to run before the screenshot) and
`cooper.preview.forceDisplay` (show VRAM even if the screen is still blanked).

---

## 7. Debug

The jewel. Workflow:

1. **Set a breakpoint** — in the sidebar under **SYMBOLS**, click a function (e.g.
   `enemies_update`). It appears under **BREAKPOINTS** in the Run-and-Debug view.
   Click the symbol again to remove it.
2. **Start** — click **Debug** (sidebar) or press **F5**. luna launches and pauses
   at the program's entry.
3. **Run to your code** — press **Continue** (F5). It stops at your breakpoint.
4. **Inspect** — open **Run and Debug** (`Ctrl/Cmd+Shift+D`):
   - **CALL STACK** shows the stop (e.g. `enemies_update @ 00:84AB`). **Click the
     frame** to populate the variables.
   - **VARIABLES → Registers**: `PC, A, X, Y, SP, DP, DB, PB, P` (status flags
     decoded as `nvmxdizc`), `E`.
   - **WATCH**: type a symbol or address (`frame_count`, `$7E0030`) to read it.
   - **Data breakpoint**: in WATCH, right-click → *Break on Value Change* → stops
     at the instruction that writes that address.
5. **See the PPU at the stop** — sidebar → **PPU VIEWERS**:

| Palette (CGRAM) | Sprites (OAM) | Tiles (VRAM) |
|---|---|---|
| 16×16 colour grid | the 128-sprite table | the decoded tile sheet |

![VRAM tile sheet](images/vram.png)

### Source-level (C line) debugging

With a compiler built from the patched `cc65816`/QBE, Cooper debugs at the **C
source line**: set breakpoints **in the `main.c` gutter**, and when you stop, your
**C line is highlighted** and the call stack shows `main.c:line`. Cooper passes the
debug-info build flags automatically. If the compiler isn't patched, the debugger
gracefully falls back to the symbol/register level (the frame shows a symbol, no
highlighted line).

---

## 8. C IntelliSense

Open a `.c` file in an OpenSNES project and Cooper **writes a `.clangd`
automatically** (it never overwrites an existing one). With clangd installed,
hover a `#define`, **F12** to jump to a definition, get completion — exactly what
the build's clang lint sees. Turn auto-config off with
`cooper.autoConfigureClangd: false`; reconfigure manually with **Cooper: Configure
clangd**.

> Caveat: clangd uses the host target where `int` = 4 bytes; on the SNES `int` = 2.
> Fixed-width types (`u8`/`u16`/…) are always correct; for sizes, the `cc65816`
> build is the authority.

---

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| **No C completion / "clangd not installed"** | Click **Install** on the clangd prompt (or `clangd: Download language server`). |
| **`…/make/common.mk: No such file`** on build | Set `cooper.opensnesPath` to your OpenSNES release. |
| **Run/Debug: "luna not found"** | Set `cooper.lunaPath` to the luna binary **or** its folder. |
| **Debug does nothing** | Make sure the ROM is built (Build first). A stale `launch.json` `program` self-heals as of 0.12.1; you can also delete the `program` line entirely. |
| **VARIABLES is empty while paused** | Click the frame in **CALL STACK** to select it; expand **Registers**. |
| **`#include <snes.h>` shows errors** | Run **Cooper: Configure clangd**, then restart the clangd server. |

---

## 10. What's next

- **Asset editors** — palette / tiles / map editing.
- **AI helper** — an OpenSNES-aware assistant that verifies in luna.

See `docs/DECISIONS.md` and `.claude/notes/roadmap.md` for the full plan.
