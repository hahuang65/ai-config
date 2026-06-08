# pi Harness — PRD

## Problem Statement

The repo configures three AI coding harnesses, but only two are live. **pi** (`@oh-my-pi/pi-coding-agent`, **config root** `~/.pi/agent`) exists as a **pending harness module** — a documented slot with `harness_pending=true` and a no-op `install_module`, scaffolding nothing. It was parked deliberately: pi can't be admitted to the fleet until the guardrails it must enforce live somewhere a thin adapter can reach. That blocker is now gone — the guardrail consolidation (ADR-0012) put every command/content guardrail in the shared **guard core**, enforced uniformly through per-harness adapters.

So pi is ready to come in. Bringing it live means three things must hold, the same invariants the other two harnesses satisfy: every **mandatory policy floor** guardrail must be enforced on pi (proven, not assumed); pi must see only its own module's files plus the curated shared set (the **isolation invariant**); and the shared **advisory rules** must reach it. The third is the only genuinely new problem — pi has neither Claude's always-on rules-dir injection nor oh-my-pi's native rulebook, so the rules need a **rule projection** built for pi's context model (ADR-0013).

## Solution

Fill the pending slot and flip pi live, applying the established **harness module** (ADR-0010) and ports-and-adapters guardrail (ADR-0011/0012) patterns, plus the one new mechanism ADR-0013 settled:

- **Tier-A guard adapter.** A thin pi extension — a twin of the oh-my-pi adapter — normalizes pi's structured `tool_call` event and routes it through the shared guard core. Zero detection logic of its own; the same matchers that run on Claude and oh-my-pi run on pi. Because pi has no built-in permission system, this extension is pi's *entire* policy layer.
- **Rule concatenation (the new part).** The advisory rules reach pi as a committed, generated **concatenation** symlinked as pi's always-on `APPEND_SYSTEM.md`. A regeneration target keeps it derived from the rules; a gate **drift-check** makes a stale concatenation un-committable. This is the third **rule projection** mechanism, sized to pi's single-file context model.
- **Module wiring.** `install_module` symlinks the guard extension into pi's auto-discovered extensions location, installs a repo-managed `settings.json`, and symlinks the concatenation. pi consumes skills, commands, and agents through the generic install loop; `harness_pending` flips to false.
- **Proof.** The **conformance test** grows a third column — every floor guardrail must enforce on pi. The **isolation test** gains `~/.pi/agent` as a third owned config root. A new pi-adapter test proves the twin actually wires the core.

When done, adding pi was filling in a module — exactly what the slot was designed to make possible.

## User Stories

1. As a pi user, I want every floor guardrail enforced when I run pi, so that the same dangerous tool calls blocked on Claude and oh-my-pi are blocked on pi too.
2. As a security-conscious maintainer, I want pi's guardrails to be the *same* shared matchers as the other harnesses, so that there's no second copy of detection logic to drift.
3. As a maintainer, I want the conformance matrix to show a third column for pi with no floor gaps, so that pi's coverage is proven, not assumed.
4. As a maintainer, I want pi to enforce guardrails through a thin adapter, so that bringing it in was filling a slot rather than re-implementing safety.
5. As a pi user, I want the shared advisory rules to reach pi, so that I get the same coding-style/testing/security guidance I get on the other harnesses.
6. As a maintainer, I want pi's advisory rules to stay in sync with the canonical `rules/` automatically-enough that I can't ship them stale, so that editing a rule and forgetting a regeneration step fails the gate instead of silently shipping old guidance.
7. As a maintainer, I want a rule edit to reach pi without re-running the installer every time, so that the day-to-day loop is edit-regenerate-commit, with the installer run once.
8. As a maintainer, I want pi to see only its own module's files plus the curated shared set, so that the isolation invariant holds for three harnesses, not two.
9. As a maintainer, I want pi's runtime config (provider, model, thinking) version-controlled and mirroring the oh-my-pi default, so that the fleet's defaults are consistent and reviewable, while staying user-editable.
10. As a pi user, I want my skills available as `/skill:name` and my commands as clean `/name`, so that the shared command set works the way pi surfaces it.
11. As a maintainer, I want the whole gate (`make test`) — including a self-test that a stale concatenation is rejected — green, so that the pi integration is covered the same way everything else is.
12. As a maintainer, I want pi added as one module with no restructuring of the others, so that the modular-harness design is validated by a real third harness.

## Implementation Decisions

- **The guard adapter is a tier-A twin (ADR-0011).** pi's extension API mirrors oh-my-pi's: it subscribes to the `tool_call` event, reads the structured tool name and input (command, path, content), routes through the shared guard core's single entry point, and returns a block verdict with the core's reason. It carries no policy logic. It installs as a pi **extension** (pi auto-discovers extensions from its config root), not as a hook — pi's discovery location differs from oh-my-pi's, the adapter shape does not.
- **Advisory rules project as a gate-checked concatenation (ADR-0013).** pi reads single always-on context files and does not expand file-reference includes, so the six advisory rules are joined (with per-rule headers) into one committed file, symlinked as pi's `APPEND_SYSTEM.md`. A regeneration target derives it from `rules/`; a gate drift-check regenerates-and-compares and fails on staleness. Chosen over a lazy progressive-disclosure index (always-on is more reliable for a few small, always-relevant rules, and matches Claude's treatment) and over generating into the home directory at install time (a committed, symlinked artifact is live after one install and its drift is catchable from the repo). This is the third rule projection; there is no single shared rules-delivery path across harnesses.
- **`consumed_categories` = skills, commands, agents.** Rules are *not* consumed as a symlinked directory for pi — they arrive via the concatenation. Commands are consumed without skill-deduplication (pi surfaces skills and commands in distinct namespaces).
- **`settings.json` is repo-managed.** The module installs a version-controlled `settings.json` (provider/model/thinking) mirroring oh-my-pi's Anthropic Opus default; the user may edit it.
- **Isolation is automatic and asserted.** pi does not scavenge sibling config roots by default and we never point pi's settings at one, so **cross-discovery** stays off without extra configuration. The isolation test adds `~/.pi/agent` as a third owned config root and fails on any leak.
- **Out of the guard core, nothing new.** No new guardrail detection — the twelve policies are done. pi inherits all of them.

## Testing Decisions

- **What a good test is here.** Tests assert observable behavior through public seams: a tool call through the pi adapter yields the right block verdict; the conformance matrix proves coverage; the drift-check proves the concatenation can't go stale silently. Behavior over implementation; shared setup with minimal per-case mutation; sentence-style names.
- **pi-adapter unit test (primary).** An in-process test that imports the adapter, drives it with a representative `tool_call` event for a floor guardrail, and asserts it blocks with the core's reason — the twin of the existing oh-my-pi-adapter test. This proves the adapter actually wires the core (not that the core works — that's already covered).
- **Conformance extends to pi.** The coverage matrix gains a third harness column; the existing floor-gap assertion now requires every floor policy enforced on pi as well. Driven by the same registry examples, so no per-policy test additions — pi either covers the floor or the matrix shows a gap and fails.
- **Rule-concatenation drift gate (the ADR-0013 guarantee).** A `test/content` check regenerates the concatenation from `rules/` and fails if the committed file differs. A `test/meta` self-test fixture plants a stale concatenation and asserts the pipeline rejects it — the same self-test discipline that guards the other pipeline checks.
- **Isolation and install coverage.** The isolation test asserts `~/.pi/agent` contains only the pi module's files plus the curated shared set. The install path is exercised so the pi module wiring (extension symlink, settings, concatenation symlink, consumed categories) is real, not assumed.
- **The whole gate stays green.** `make test` (content + install + guard + meta) passes end to end.

## Out of Scope

- **Gondolin / VM sandboxing** — the deferred tier-D isolation layer; orthogonal to admitting pi.
- **Any new guardrail detection** — the twelve policies are complete; pi only inherits them.
- **The four fuzzy `security.md` anti-patterns** — they remain advisory and now reach pi via the concatenation like the other advisory rules.
- **A general neutral-instruction-file mechanism** beyond the rules concatenation — the broader instruction-file projection stays deferred.

## Further Notes

- The whole point of the prior consolidation pays off here: pi inherits twelve guardrails through one thin adapter and a conformance column, with no detection logic written. That's the modular-harness thesis demonstrated by a real third harness.
- A few pi specifics (exact extension event field names, the auto-discovery location, that write/edit input carries content) are verified during implementation rather than assumed — the conformance test is self-checking, so any mismatch fails loudly rather than silently weakening enforcement.
- pi's `APPEND_SYSTEM.md` echoes oh-my-pi's committed `RULES.md`: a harness-specific, version-controlled projection of the shared rules installed into the config root. The new part is the *always-on concatenation* semantics and the drift gate, not the committed-and-symlinked shape.
