# Advisory rules reach pi as a gate-checked generated concatenation (always-on AGENTS.md)

Bringing the **pi** harness (`@earendil-works/pi-coding-agent`, config root `~/.pi/agent`) live raised one genuinely new question: how do the shared **advisory rules** (`coding-style`, `testing`, `performance`, `git-commit`, `mise`, `security`) reach pi? Enforcement is already solved — pi inherits all guardrail policies through one tier-A extension routing the guard core (ADR-0011/0012). But advisory *guidance* has no obvious path, because pi's context model differs from both existing harnesses.

## What pi actually supports

From pi's shipped docs and binary: pi loads global always-on instructions from a **single file**, `~/.pi/agent/AGENTS.md`, read at startup, plus a `SYSTEM.md` that *replaces* the system prompt and project `AGENTS.md`/`CLAUDE.md` discovered walking up from cwd. It does **not** read a global rules *directory*, and it does **not** expand `@import`/file-reference includes inside context files. So the two mechanisms the other harnesses use are both unavailable:

- **Claude** auto-injects every `rules/*.md` from its rules dir, always-on.
- **oh-my-pi** lists rules in its native **rulebook** and loads them lazily via `rule://<name>` (ADR-0002).
- **pi** has neither a rules-dir auto-injection nor a rulebook.

## Decision

Project the advisory rules into pi as a **committed, generated concatenation** — `harnesses/pi/advisory-rules.md`, the six advisory rules joined with per-rule headers — **symlinked** as pi's global `~/.pi/agent/AGENTS.md` (always-on instructions). The committed file carries a *distinct* source name (not `AGENTS.md`) so it isn't confused with the repo-root authoring contract and isn't swept up by a global `AGENTS.md` gitignore; only the installed symlink is named `AGENTS.md`. This is **the third rules-projection mechanism**: Claude (dir auto-inject, always-on), omp (native rulebook, lazy), **pi (generated concatenation, always-on)**.

Two sub-decisions, each a real fork:

- **Always-on concatenation, not a progressive-disclosure index.** A lazy "index in `AGENTS.md` + read `rules/<name>.md` on demand" was considered and rejected. For six small, always-relevant advisory rules, always-on is simpler and *more reliable* — advisory guidance only helps if the model sees it, and lazy loading means it often won't. It also matches Claude's treatment exactly; the always-on context cost (a few K tokens) is modest and bounded. Progressive disclosure earns its keep for large, numerous resources (skills), not for this.
- **Committed + symlinked + gate-checked, not generated-into-`$HOME` at install.** A file generated directly into `~/.pi/agent/` at install time **drifts** the moment a rule is edited without re-running `install.sh`, and `$HOME` state can't be validated from the repo. Instead the concatenation is a **committed repo artifact**, symlinked once; a `make test` **drift-check** regenerates from `rules/*.md` and fails if the committed file is stale. So a forgotten regeneration **fails the pre-commit gate** — staleness can't be committed — and because the installed path is a symlink, edits flow to pi **live, with no re-install**. This matches the repo's existing "generated artifact + drift-check" pattern (conformance, guide-sync).

## Consequences

- A new repo artifact (`harnesses/pi/advisory-rules.md`), a `make` target that regenerates it from `rules/*.md`, and a `test/content` drift-check. Editing a rule now requires regenerating the concatenation — but the gate enforces it, so the cost is mechanical, not a discipline risk.
- **pi's `consumed_categories` = `skills`, `commands`, `agents`** — *not* `rules` as a symlinked directory. The advisory rules reach pi only through the generated `harnesses/pi/advisory-rules.md` (installed as pi's `AGENTS.md`, **distinct** from the repo-root `AGENTS.md` authoring contract, which is never installed); enforcement reaches it through the tier-A guard extension.
- Updates **ADR-0009**'s "agents and rules reach every harness": rules now reach all three harnesses, but via **three distinct mechanisms** sized to each harness's context model — there is no single shared rules-delivery path.
- `install.sh` for the pi module symlinks the concatenation once; thereafter rule edits are live through the symlink. The rest of the pi integration (repo-managed `settings.json`, automatic isolation, conformance/isolation extended to the third harness) is a straight application of ADR-0010/0011/0012.
- **One non-obvious install mechanic:** pi — unlike oh-my-pi — does **not** realpath-resolve a symlinked extension, so the guard adapter's relative `shared/guard-core` import can't be followed through the install symlink (the smoke test caught this; the in-repo conformance test passed because bun *does* realpath-resolve, masking it). The adapter is therefore shipped as a **committed, self-contained bundle** (`make bundle` → `harnesses/pi/guard-policies.bundle.ts`; deterministic via mise-pinned bun, drift-checked, with a self-test) and symlinked as pi's extension. This keeps `install.sh` symlink-only (no toolchain at install) and keeps the source adapter (`extensions/guard-policies.ts`) as the conformance-tested unit. Bundling because pi runs **unguarded** without a loadable extension — so a stale or missing bundle is a gate failure, not a warning.
