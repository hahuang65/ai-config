# Shared skill references

This directory is **not a skill** — it has no `SKILL.md`. It holds reference files imported by **more than one** skill, so the detail lives in exactly one place.

Skills import these by relative path, e.g. from `skills/spec/SKILL.md`:

```
../shared/references/build-pipeline.md
```

| File | Imported by |
|------|-------------|
| `references/build-pipeline.md` | build, grill, spec, todo, code, coach |
| `references/review-artifact.md` | build, spec, todo, review-code, review-artifact |
| `references/tdd-protocol.md` | code, coach |
| `references/testable-interfaces.md` | build, spec, todo, code, coach |
| `references/tooling.md` | code, coach, refactor |
| `references/implementation-hygiene.md` | code, coach |
| `references/implementation-completion.md` | code, coach |
| `references/context-format.md` | grill, review-code |
| `references/adr-format.md` | grill, review-code, prototype |

`install.sh` symlinks every `skills/*/` directory (including this one), so `../shared/references/...` resolves both in-repo and after install. `scripts/test-pipeline.sh` skips `shared` in its per-skill `SKILL.md` checks.
