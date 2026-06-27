# .claude/notes — context bucket

Three buckets in this repo, by purpose:

| Bucket | What | Loaded |
|---|---|---|
| `CLAUDE.md` | load-bearing facts + the operating manual | every session |
| `.claude/rules/` | normative rules (how we work) | referenced by CLAUDE.md |
| `.claude/notes/` | context (what the project is, where it stands) | on demand |
| `docs/` | the design dossiers + decision log (public-facing) | on demand |

Rules enforce behavior; notes record context; docs are the durable design.

## Files here

- `project-overview.md` — the clear, complete description of Cooper: vision,
  the ownership superpower, the ring, capabilities, competitive position.
- `status.md` — what's shipped, what's next, where the decisions live.

When you learn something durable about the project, put it in the right bucket:
a *rule* if it should change behavior, a *note* if it's context, `docs/DECISIONS.md`
if it's a decision, `docs/*.md` if it's design.
