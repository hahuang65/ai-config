# Shared skill references

This directory is **not a skill** — it has no `SKILL.md`. It holds reference files imported by **more than one** skill, so the detail lives in exactly one place.

Skills import these by relative path, e.g. from `skills/prd/SKILL.md`:

```
../shared/references/build-pipeline.md
```

| File | Imported by |
|------|-------------|
| `references/build-pipeline.md` | build, grill, prd, tasks, implement, implement-coach |
| `references/artifact-review.md` | prd, tasks |
| `references/tdd-protocol.md` | implement, implement-coach |
| `references/testable-interfaces.md` | prd, tasks, implement, implement-coach |
| `references/tooling.md` | implement, implement-coach, refactor |
| `references/review-chain.md` | implement, implement-coach |
| `references/implementation-completion.md` | implement, implement-coach |
| `references/context-format.md` | grill, improve-codebase |
| `references/adr-format.md` | grill, improve-codebase, prototype |

`install.sh` symlinks every `skills/*/` directory (including this one), so `../shared/references/...` resolves both in-repo and after install. `scripts/test-pipeline.sh` skips `shared` in its per-skill `SKILL.md` checks.
