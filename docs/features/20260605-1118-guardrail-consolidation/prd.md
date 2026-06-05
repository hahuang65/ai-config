# Guardrail Consolidation — PRD

## Problem Statement

The ports-and-adapters guardrail work moved the *floor* guardrails (read a secret, curl-pipe-to-shell, broad `rm`, `sudo`) into the shared **guard core**, so every harness enforces them through one detection layer. But a whole second tier of enforcement was left behind as **oh-my-pi TTSR rules** — cloud teardown, deploys, database mutation, raw-disk `dd`, shell-redirect writes, broad recursive `chmod`, destructive git, and the hardcoded-secret check inside `security.md`.

That leftover tier is enforced unevenly. TTSR is oh-my-pi-only, so on oh-my-pi those patterns are caught at runtime — but on Claude Code they degrade to always-on guidance plus a handful of static deny patterns, and on a future harness with no stream-rule mechanism they would not be enforced at all. The same guardrail intent is therefore expressed in three different strengths depending on the harness, and adding a new harness means re-answering "is this one enforced here?" for every one of these patterns. The security posture is inconsistent and not provable across the fleet.

## Solution

Finish the consolidation ADR-0011 began: **migrate every remaining command-pattern guardrail, plus the one hard-blockable content pattern, into the guard core** — so all enforcement lives in one place and projects uniformly into every harness through its adapter, conformance-checked. `rules/` is left holding only **advisory** guidance, and the oh-my-pi **TTSR** mechanism is retired (ADR-0012, superseding ADR-0003).

Concretely:

- The seven command-pattern enforcement rules become **guardrail policies** in the guard core, each a detector over the normalized command (reusing the existing command-traversal). Once in the core, they are enforced identically on every harness that runs the core — no per-harness reimplementation.
- `security.md` is **split**: its one high-confidence, low-false-positive pattern — a hardcoded secret literal in written content — becomes a guardrail policy; the rest (fuzzy code anti-patterns and always-on principles) stays as an advisory rule.
- The guard core gains the ability to inspect **written content** (not just command and path), which is what the hardcoded-secret policy needs.
- The standalone `no-force-push` policy is absorbed into a broader `no-git-destructive`, and the **mandatory policy floor** is widened to cover everything except the lone visibility-oriented guardrail.

The result: one detection layer, one conformance guarantee, and a `rules/` directory that is purely advisory — which is exactly what lets a new harness (pi, next) inherit the entire guardrail set through a single adapter.

## User Stories

1. As a security-conscious maintainer, I want every command-pattern guardrail defined once in the guard core, so that the same intent isn't expressed three different ways across harnesses.
2. As a security-conscious maintainer, I want cloud-teardown commands refused on every harness, so that an agent can't autonomously destroy shared infrastructure regardless of which harness I'm running.
3. As a security-conscious maintainer, I want database-mutation commands refused uniformly, so that a `DROP`/`TRUNCATE`/`DELETE` through a CLI is blocked everywhere, not just on one harness.
4. As a security-conscious maintainer, I want raw-disk `dd` refused on every harness, so that a catastrophic disk overwrite can't slip through on a harness that lacks stream rules.
5. As a security-conscious maintainer, I want deploy commands refused on every harness, so that production isn't changed autonomously anywhere.
6. As a security-conscious maintainer, I want broad recursive `chmod` refused on every harness, so that an agent can't lock me out of my home or system directories.
7. As a security-conscious maintainer, I want destructive git commands refused on every harness, so that history-rewriting and work-destroying operations are blocked uniformly — with the old force-push guardrail subsumed into one broader policy.
8. As a security-conscious maintainer, I want shell-redirect file writes refused on every harness, so that writes can't bypass the per-file approval the write/edit tools provide.
9. As a security-conscious maintainer, I never want a hardcoded secret literal written into a file, so that credentials in a known format can't be committed to a repo, on any harness.
10. As a security-conscious maintainer, I want a blocked action to still be instructive, so that the refusal tells the agent the right approach (hand the command to me, produce the plan, use the write tool) rather than just saying "no".
11. As a security-conscious maintainer, I want the new policies on the mandatory floor (except the one visibility guardrail), so that no harness can be admitted to the fleet while silently missing them.
12. As a security-conscious maintainer, I want one policy left deliberately off the floor, so that the conformance test keeps proving it can tell floor from non-floor.
13. As a maintainer, I want `rules/` to contain only advisory guidance after this change, so that "is this a rule or an enforced guardrail?" has a clean, unambiguous answer.
14. As a maintainer, I want the retired stream-rule mechanism removed from every rule file, so that no enforcement hides in frontmatter that only one harness understands.
15. As a maintainer, I want the validation pipeline to stop checking for the retired mechanism and instead assert it's gone, so that a stray enforcement rule can't sneak back in.
16. As a maintainer adding pi later, I want the entire guardrail set reachable through one adapter, so that pi inherits every policy by routing the core — no rule mechanism required.
17. As a security-conscious maintainer, I want the conformance matrix to show every floor policy enforced on every harness with no silent gaps, so that the consolidation is provable, not assumed.
18. As a maintainer, I want Claude's static deny patterns kept as defense-in-depth, so that the fast declarative layer still fires even before the programmable core runs.

## Implementation Decisions

- **Seven command-pattern policies migrate into the guard core (ADR-0012).** `no-cloud-destroy`, `no-deploy`, `no-db-mutation`, `no-dd-disk`, `no-shell-write`, `no-broad-chmod`, `no-git-destructive` — each a detector over the normalized command, reusing the existing pipeline-aware command traversal (the same one the floor command policies already use). No new parsing machinery.
- **`security.md` split → `no-hardcoded-secret`.** A guardrail policy that inspects **written content** for a hardcoded secret literal matched by known credential *formats* (provider key prefixes, AWS access-key shape, PEM private-key header). High-confidence, low-false-positive. The four fuzzy anti-patterns (string-concatenated SQL, `eval` on dynamic input, `exec` with concatenation, unsanitized input to a file API) and the always-on principles remain in the advisory `security` rule.
- **The guard core gains a `content` field** on the normalized tool call. Only `no-hardcoded-secret` reads it. Each per-harness adapter passes the write/edit payload through — the structured tool input already carries it (a write tool's content; an edit tool's replacement text). Adapters stay thin; detection stays in the core.
- **`no-force-push` is absorbed into `no-git-destructive`.** The broader policy covers force-push, hook/sign-bypass flags, hard reset, force-clean, and amending a pushed commit. The standalone `no-force-push` policy and its probes are removed.
- **Mandatory policy floor widens to all policies except `no-shell-write`.** Floor: `no-secret-access`, `no-hardcoded-secret`, `no-curl-pipe-shell`, `no-broad-rm`, `no-sudo`, `no-cloud-destroy`, `no-db-mutation`, `no-dd-disk`, `no-broad-chmod`, `no-git-destructive`, `no-deploy`. `no-shell-write` is the lone non-floor policy (it guards approval *visibility*, not an irreversible action) and serves as the conformance discriminator the removed `no-force-push` used to provide.
- **Every policy carries boundary examples in the registry** — a violating `example` and a benign `counterExample` — the existing registry convention, which the conformance test consumes as its probe and the unit tests check both sides of.
- **Refusal reasons carry the guidance.** Each migrated policy's "right approach" (hand the command to the user, produce the plan for review, use the write/edit tool) moves into its refusal reason, so a block stays instructive even though the rule file is gone.
- **The seven migrated rule files are deleted; TTSR is retired.** No `rules/*.md` will carry the stream-rule frontmatter. `rules/` ends advisory-only: `coding-style`, `testing`, `performance`, `git-commit`, `mise`, `security`.
- **Claude's static deny patterns are unchanged** — kept as fast declarative defense-in-depth alongside the programmable core.

## Testing Decisions

- **What a good test is here.** Tests assert observable behavior through the public interface: given a normalized tool call, the guard core returns the right verdict; given the registry, the conformance test proves every floor policy is enforced by every harness with no silent gap. Tests follow the testing rules — behavior over implementation, shared setup with minimal per-case mutation, sentence-style names.
- **Guard core unit tests (the primary target).** Each new policy gets positive and negative cases exercised through the single `evaluate` entry point: a representative violating command (and, for `no-hardcoded-secret`, a representative violating write content) blocks; a benign near-miss does not. The content policy specifically must **not** fire on a placeholder (e.g. an obvious dummy key) or on ordinary prose that merely mentions a key — the boundary that keeps content-blocking false-positive-safe.
- **Conformance test extends automatically.** It iterates the registry, so the new floor policies and their probes are covered the moment they're registered; the coverage matrix grows to show each enforced on both harnesses. `no-shell-write` remains the non-floor entry that proves the floor/non-floor discriminator still works. Prior art: the existing conformance test and its `example`/`counterExample`-driven probes.
- **Adapter coverage.** The omp-adapter and Claude-shim tests confirm each adapter routes a call through the core and now forwards write content; a hardcoded-secret write is blocked end-to-end on both.
- **The validation pipeline's rule checks are updated.** The check that validated stream-rule frontmatter is retired and replaced by an assertion that **no** rule carries it (so a re-introduced enforcement rule fails the gate); the advisory-rule checks (every rule still has a description) stay. The pipeline self-test stays green.

## Out of Scope

- **The pi harness** — the deferred follow-up that consumes this finished guardrail set.
- **Gondolin / VM sandboxing** — the orthogonal tier-D isolation layer.
- **The four fuzzy `security.md` anti-patterns** — string-concat SQL, `eval`, `exec`-with-concat, input→file-API — stay advisory; they are too false-positive-prone for a hard block.
- **Any content inspection beyond `no-hardcoded-secret`** — the `content` field exists, but no other policy reads it in this work.
- **Reworking Claude's static deny patterns** — left as-is.

## Further Notes

- This completes the arc ADR-0011 started: after it, **all** command/content guardrail enforcement lives in the guard core, and `rules/` is purely advisory. The payoff compounds next: pi inherits every policy through one adapter.
- Content-blocking is deliberately narrow. Only `no-hardcoded-secret` — and only against known credential *formats* — earns a hard block. Detecting "a secret" generically, or the fuzzier code anti-patterns, is left to advisory guidance precisely to avoid blocking legitimate writes.
- Advisory rules still don't reach a harness that lacks a guidance mechanism — but that's a guidance gap, not a safety hole, because every *enforced* guardrail now travels through the core, not through rules.
