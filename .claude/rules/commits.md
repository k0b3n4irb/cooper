# Commit rules

## Format

[Conventional Commits](https://www.conventionalcommits.org/): `type(scope):
description`. Types: `feat`, `fix`, `refactor`, `docs`, `chore`, `build`, `test`,
`ci`, `revert`. Scopes used in Cooper: `lang`, `c`, `build`, `debug`, `assets`,
`ai`, `docs`, `claude`, `test`, `deps`. Imperative mood, no trailing period.

## NEVER add Co-Authored-By trailers

Do **not** add `Co-Authored-By` (or `Co-authored-by`, any variant) to commit
messages. No AI attribution in git history. Ever. No exceptions.

## Identity

`git config user.email k0b3n4irb@gmail.com` (the GitHub account email).

## The global pre-commit hook bypass

OpenSNES installs a **global** git pre-commit hook that blocks any commit until
its test suite ran today. It fires in **this** repo too, but **Cooper has no
relation to the OpenSNES test suite**. For Cooper commits this bypass is
legitimate and expected:

```bash
# SEPARATE bash call, BEFORE git commit (cannot be in the same command):
touch /tmp/opensnes_tests_passed_$(date +%Y-%m-%d)
```

Then commit. (To-do, low priority: scope the hook to the OpenSNES repo so it
stops firing here.)

## Before committing

Run the verification for the change (see `workflow.md` / `extension-dev.md`):
build clean, tests pass, `vsce package` clean. Don't commit on "it compiled".
