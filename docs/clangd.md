# C language support (clangd) for OpenSNES

Cooper uses **clangd** (off-the-shelf, via the official
[`llvm-vs-code-extensions.vscode-clangd`](https://marketplace.visualstudio.com/items?itemName=llvm-vs-code-extensions.vscode-clangd)
extension, installed automatically as part of the Cooper extension pack) for C
completion, navigation, hover, and refactoring on OpenSNES code.

Cooper does **not** reimplement a language server — it provides the OpenSNES
*glue*: the clangd configuration that makes the SDK's C parse correctly, and an
honest account of the one place clangd cannot be trusted on this target.

## The config

clangd needs to find `snes.h` and parse the SDK headers the way the build does.
Put a `.clangd` file at your project root:

```yaml
# .clangd — OpenSNES C language support
# Replace /path/to/opensnes with your OpenSNES SDK checkout.
CompileFlags:
  Add:
    - "-I/path/to/opensnes/lib/include"   # <snes.h>, <snes/*.h>
    - "-I."                               # project-local + generated headers
    - "-std=gnu11"                        # cproc targets C11
    - "-Wno-pointer-to-int-cast"
    - "-Wno-int-to-pointer-cast"
    - "-Wno-unused-parameter"
```

These flags **mirror the SDK's own `clang -fsyntax-only` lint pass**
(`make/common.mk`, `CLANG_LINT_FLAGS` + `-I lib/include`), so what clangd sees
matches what the build's sibling-compiler check sees.

> A future Cooper release will generate this `.clangd` for you (detecting the SDK
> path from your project), so you won't edit the path by hand. For now it's a
> one-line copy-paste.

`compile_flags.txt` (one flag per line) is an equivalent fallback if you prefer.
A full `compile_commands.json` is the gold standard but unnecessary here — every
OpenSNES translation unit uses the same flags.

### Verified

These exact flags were validated with `clang -fsyntax-only` against the **entire
OpenSNES example corpus — 56/56 `main.c` parse clean** (snes.h + all `snes/*.h`
sub-headers resolve, including generated graphics headers via `-I.`).

## ⚠️ The one caveat: clangd lies about `int` size

On the SNES target, the cc65816 toolchain uses **`int` = 2 bytes**, `long` = 4
bytes. clangd runs the **host** clang (where `int` = 4 bytes), and there is no
clang target that models the 65816, so:

- **Fixed-width types are correct.** `u8`/`u16`/`u32`/`s8`/`s16`/`s32` (from
  `snes.h`) are typedefs that resolve to the right *size* on the host too — use
  them and clangd is trustworthy.
- **Plain `int`/`unsigned int` are NOT.** clangd thinks they're 4 bytes; on
  target they're 2. Any size-, overflow-, or shift-related hint clangd gives for
  a plain `int` may be wrong for the actual ROM.
- **Authority for correctness = the `cc65816` build**, not clangd. clangd is for
  *completion and navigation*; the compiler is the source of truth for what the
  code actually does.

This is deliberate and matches the SDK itself: its `clang` lint pass also omits
`-D__OPENSNES__` on purpose — passing it on a 64-bit host would make
`long`-backed `s32` 8 bytes and break `sizeof(s32) == 2`-vs-`4` expectations.
See `lib/include/snes/types.h` for the full explanation.

**Rule of thumb:** prefer the fixed-width types (`u8`/`u16`/…) in game code —
they're unambiguous to both clangd and the compiler.

**Cooper surfaces this for you (C2 v2, D-077).** Hovering a plain `int`/`long` in
an OpenSNES project shows a reminder that it's 2/4 bytes on the SNES (not 4/8) and
suggests the fixed-width type. It's hover-only (never a diagnostic), so it can't
misfire — it just adds the SNES truth next to clangd's host-target hover.
