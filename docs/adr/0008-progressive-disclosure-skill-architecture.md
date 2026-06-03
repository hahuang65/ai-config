# Progressive-disclosure skill architecture, grafted onto existing content

We restructured the skills around progressive disclosure: a thin `SKILL.md` entry point that defers detail to `references/*.md` read on demand, a condensed `/build` orchestrator whose gate/convention/session detail lives in a reference, and a **global shared reference directory** (`skills/shared/references/`) that holds any reference imported by more than one skill — the build-pipeline protocol, the TDD protocol, the tooling/verification loop, the post-implementation review chain, the completion section, and the `CONTEXT.md`/ADR formats. Skills import these by relative path (e.g. `../shared/references/build-pipeline.md`); detail used by a single skill lives in that skill's own `references/`. This is applied to the pipeline skills (`build`, `grill`, `prd`, `tasks`, `implement`, `implement-coach`, `visual-explainer`) and the standalone skills that had extractable detail (`handoff`, `prototype`, `improve-codebase`, `refactor`).

The non-obvious part — and the reason this is recorded — is the **direction**: re-express this repo's existing content under progressive disclosure rather than thinning it down to bare entry points. The skills are deliberately rich (the `tdd-guide` agent per slice, the `code-cleaner` skill, agent-based `code-reviewer`/`refactor-cleaner`/`database-reviewer`/`doc-updater` reviews, standing-authorization, OWASP-via-`rules/` detail, and the existing `/refactor` + `/improve-codebase` wiring). Stripping that content to minimal files would be a net capability regression and would break `scripts/test-pipeline.sh`, which asserts the skills name those agents and commands. So detail is **relocated** into `references/`, never deleted.

## Considered Options

- **Strip skills to minimal entry points** — simplest files, but a net capability regression and a self-test rewrite. Rejected.
- **Re-express existing content under progressive disclosure** (chosen) — preserve the agent-based delivery model and all wiring; move bulky detail into per-skill or shared `references/`.

## Consequences

- `guide.html` companions are **kept** alongside the new `references/` splits: they target different readers (`guide.html` = human standalone guide; `references/*.md` = on-demand agent detail) and must stay in sync with `SKILL.md`.
- References imported by more than one skill live in `skills/shared/references/`; single-skill detail lives in that skill's own `references/`. `skills/shared/` is intentionally **not** a skill (no `SKILL.md`); `install.sh` still symlinks it so relative imports resolve after install.
- Architectural and restructuring work still routes to the existing `/improve-codebase` and `/refactor` skills; reviews are delivered by agents, so no separate review *skills* are introduced. That wiring stands.
- `api-design` and `frontend-patterns` are left intact: they are compact leaf reference skills whose whole `SKILL.md` is the on-demand payload, with no bulky detail to extract and nothing shared across skills.
- `scripts/test-pipeline.sh` assertions are preserved and extended: `test_symlink_targets` skips the non-skill `shared` dir, a new check resolves every `references/...md` link in each `SKILL.md`, the phase checks read each `SKILL.md` plus the references it actually imports (so a relocated phrase still registers, but only where the skill genuinely links it), and stale-stub scanning covers the shared references.
