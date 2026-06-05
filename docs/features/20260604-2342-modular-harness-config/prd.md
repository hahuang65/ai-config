# Modular Harness Config & Shared Guardrails — PRD

## Problem Statement

I maintain one configuration source that powers multiple AI coding harnesses. Today it powers two (Claude Code and oh-my-pi); I'm committed to adding a third (pi) and I'm unsure whether I'll keep oh-my-pi. The current structure makes harness churn painful in three distinct ways:

1. **Adding or removing a harness is surgery, not a swap.** Each harness's install logic is a hand-written block interleaved with shared content. There's no clean seam to add a harness behind, or to delete one without leaving residue.

2. **Security intent is duplicated in incompatible formats, and drifts.** "Never read a credential file," "no curl-piped-to-a-shell," "no force-push" each exist as separate implementations — an oh-my-pi hook, a Claude shell hook, a stream rule — that say the same thing in different languages. They already disagree in details, and adding pi would add a third copy of each. There is no single place that says "this is the guarantee" and no check that every harness actually upholds it.

3. **Harnesses silently pollute each other.** Several harnesses auto-discover *other* harnesses' config — one of them reads another's skills directory by default. So a change meant for one harness leaks into another, and I can't tell what each harness is actually running. This uncertainty is, by itself, a reason I've considered dropping a harness.

I want harness churn to be cheap, security to be defined once and *provably* enforced everywhere, and each harness to see only what I deliberately gave it — with as much shared, DRY content as possible and per-harness divergence only where the harnesses genuinely differ.

## Solution

Restructure the single repo (not multiple repos, not submodules — see ADR-0010) so that every harness is a self-contained **harness module**, and security becomes a shared **policy registry** projected into each harness through its native enforcement mechanism (ports-and-adapters — see ADR-0011).

Three moves deliver this:

- **Pluggable harness modules.** Each harness owns one directory declaring its **config root**, the shared categories it consumes, and its guardrail adapter. The installer becomes a generic loop over whatever modules exist, so **adding a harness is dropping a module and removing one is deleting a directory.** Skills, commands, agents, and advisory rules keep sharing flat and verbatim exactly as they do today.

- **Guardrails as canonical policy + shared detection + thin adapters.** Each **guardrail policy** is defined once in the **policy registry** (an ID, its intent, and enforcement metadata). The detection logic is written once in the **guard core**. Each harness wires that core in through an adapter sized to its **enforcement tier** — run-in-process where the harness allows it, a thin command shim where it doesn't — keeping its own native static guards as defense-in-depth.

- **Two CI-checked invariants.** The **isolation test** proves no harness sees anything beyond its own module plus the curated shared set (cross-discovery off, no sibling leakage). The **conformance test** proves every harness covers every policy in the **mandatory policy floor** and that every other gap is *explicit*, never silent — emitting a **coverage matrix** of policy × harness.

The result: harness churn is a one-directory operation, the secrets guarantee is enforced as an invariant rather than hoped for, and divergence between harnesses is honest and visible instead of accidental.

## User Stories

1. As a config maintainer, I want each harness to live in one self-contained module, so that I can reason about a harness without untangling it from shared content.
2. As a config maintainer, I want to add a new harness by dropping in one module, so that onboarding a harness is a bounded, repeatable operation rather than bespoke surgery.
3. As a config maintainer, I want to remove a harness by deleting its directory, so that a harness leaves no residue when I drop it.
4. As a config maintainer, I want the installer to be a generic loop over modules, so that I never hand-edit install logic to add or remove a harness.
5. As a config maintainer, I want skills, commands, agents, and advisory rules to keep sharing flat and verbatim, so that the restructure costs me nothing on the content that already shares cleanly.
6. As a config maintainer, I want each config root owned exclusively by one harness module, so that ownership of every installed file is unambiguous.
7. As a config maintainer, I want cross-discovery between harnesses disabled, so that sharing is something I push deliberately, never something a harness scavenges behind my back.
8. As a config maintainer, I want a test that fails when one harness's config root contains anything from another harness, so that cross-harness pollution is caught in CI instead of discovered in confusion.
9. As a security-conscious maintainer, I want every guardrail defined once as a policy with an ID and a stated intent, so that there is a single authoritative answer to "what is the guarantee?"
10. As a security-conscious maintainer, I want the detection logic for each policy written once in the guard core, so that the same matcher is not reimplemented per harness and cannot drift between them.
11. As a security-conscious maintainer, I want each harness to enforce policies through an adapter sized to its enforcement tier, so that a harness uses its strongest available mechanism without forcing a single format on all harnesses.
12. As a security-conscious maintainer, I want programmable harnesses to run the guard core in-process, so that they get full structured-input blocking with zero duplicated logic.
13. As a security-conscious maintainer, I want a command-hook harness to invoke the same guard core through a thin shim, so that it shares the detection logic despite a different transport.
14. As a security-conscious maintainer, I want a harness to keep its native static guards as defense-in-depth alongside the shared core, so that a fast declarative denylist still fires even before the programmable layer runs.
15. As a security-conscious maintainer, I never want any harness to read my secrets, so that credential files stay unreachable regardless of which harness I'm running.
16. As a security-conscious maintainer, I want a mandatory policy floor every harness must enforce, so that no harness can join the fleet while silently missing a baseline guarantee.
17. As a security-conscious maintainer, I want a harness that cannot meet the floor to be sandboxed or rejected, so that "can't enforce the baseline" is a deliberate, visible decision.
18. As a security-conscious maintainer, I want a conformance test that fails on any silent coverage gap, so that an unenforced policy surfaces as a CI failure rather than a false sense of safety.
19. As a security-conscious maintainer, I want the conformance test to emit a coverage matrix, so that I can see at a glance how each policy is enforced on each harness, gaps included.
20. As a config maintainer, I want the three duplicated guard implementations consolidated into the guard core, so that the drift the prior decision predicted is eliminated rather than managed.
21. As a config maintainer, I want shared cross-harness instructions to live in each harness's own root from a single neutral source, so that one well-known file isn't slurped by every agent in a repo by accident.
22. As a config maintainer adding pi later, I want a clean module-shaped slot waiting for it, so that the deferred pi effort is a fill-in-the-blank, not another restructure.
23. As a config maintainer, I want the enforcement-tier model to accommodate harnesses I can't foresee, so that an arbitrary future harness maps to an existing adapter archetype instead of forcing new bespoke logic.
24. As a config maintainer, I want re-running the installer to be idempotent and to prune dangling links, so that the modular install self-heals after I rename or delete a module's contents.

## Implementation Decisions

- **Single modular repo with pluggable harness modules (ADR-0010).** Per-harness scope is a self-contained module declaring its config root, consumed shared categories, and guardrail adapter. Flat shared directories remain symlink-shared verbatim; ADR-0001 and ADR-0005 stay in force *for shared content*. Separate repos and submodules were rejected.
- **Generic install loop.** The installer iterates harness modules rather than carrying a hand-written block per harness. For each module it mirrors the curated shared set plus the module's own files into that module's config root, disables that harness's cross-discovery, and prunes dangling links. Adding/removing a harness changes only which module directories exist.
- **Isolation by explicit mirror (ADR-0010).** Each config root is push-only: it contains exactly the curated shared set plus the owning module's files. Cross-discovery providers are turned off so no harness reads a sibling's config root. Shared cross-harness instruction text lives in each harness's own root, symlinked from one harness-neutral source, rather than as a single repo-root file every agent reads.
- **Guardrail policies via ports-and-adapters (ADR-0011).** The **policy registry** holds one canonical entry per guardrail — an ID, the intent, and enforcement metadata (check kind: path / command / network / secret; minimum strength; and a **`floor` flag**). The **guard core** implements detection once. Each harness adapter is classified by **enforcement tier**:
  - *Tier A (programmable)* — runs the guard core in-process on each tool call. Applies to oh-my-pi today and pi later.
  - *Tier B (command-hook)* — a thin shim normalizes the harness's hook payload, calls the same guard core, and emits the harness's verdict format; the harness's static denylist is retained as defense-in-depth. Applies to Claude Code.
  - *Tiers C/D/E (declarative / sandbox / guidance)* — reusable archetypes for harnesses that can't run the core; out of scope to build now but part of the model so a future harness maps to one.
- **Normalized tool call.** The guard core operates on a harness-neutral shape (tool name, command string, path) so a single `evaluate` entry point serves every adapter. Each adapter's only real job is translating its harness's event into that shape and its verdict back out.
- **Conformance contract (a).** The **mandatory policy floor** is not hard-coded and not a positional marker — it is a per-policy **`floor` flag** in the registry. The conformance test derives the mandatory set by filtering the registry for flagged policies; any subset can be floor, and promoting a policy is flipping one flag rather than a schema change. Every floor policy must be enforced by every harness at tier A/B/C/D strength (a harness that can't is sandboxed or rejected); every non-floor policy is either enforced or carries an *explicit* acknowledged gap. The initial floor ships as four flagged policies — `no-secret-access`, `no-broad-rm`, `no-sudo`, and `no-curl-pipe-shell` (secret exposure plus irreversible/privileged command execution); `no-force-push` is covered but left off the floor (destructive yet recoverable and git-scoped). Tightening the contract later (floor + gaps → total coverage) is a one-line change to the test's filter, not a registry edit. The flag starts boolean; a small criticality enum is a later option only if a third strictness band appears.
- **Consolidation target.** The detection logic currently duplicated across the oh-my-pi credential/rm/sudo/curl-pipe hooks and the Claude curl-pipe shell hook moves into the guard core; the per-harness files become thin adapters over it. Output-mutating concerns (e.g. secret redaction) remain a separate post-call concern, not part of the guard core's block/allow decision.

## Testing Decisions

- **What a good test is here.** Tests assert externally observable behavior, not internal structure: given a tool call, the guard core returns the right verdict; given a populated set of config roots, the isolation test passes only when there's no leakage; given a set of adapters, the conformance test passes only when the floor is covered with no silent gaps. Tests follow the testing rules — behavior over implementation, shared setup with minimal per-case mutation, sentence-style names describing expected behavior.
- **Guard core (unit tests — primary target).** The deep module gets the real coverage: each policy's matcher is exercised with positive cases (a credential read via the read tool; a credential read smuggled through a bash reader; a curl piped or chained into an interpreter; process-substitution and command-substitution wrappers) and negative cases (prose mentioning a credential path; a benign curl) so a verdict change is caught at the unit level. Prior art: the existing quote-aware tokenizer, separator splitter, and substitution recursion in the current oh-my-pi credential hook — these move into the core and keep their behavior.
- **Install loop (behavior test).** Run the installer against a temporary home and assert the resulting config roots: correct symlinks present, dangling links pruned on re-run, cross-discovery flags off, and no symlink resolving from one harness's root into another's source.
- **Isolation test (with a test-the-test fixture).** The invariant itself is a test; it gets a deliberately planted leak (a sibling-pointing link in one config root) that must make it fail, so the invariant can't silently pass.
- **Conformance test (with a test-the-test fixture).** Backed by a planted gap — a policy removed from one adapter — that must fail the floor check, plus a check that the emitted coverage matrix lists every policy × harness. Prior art: the pipeline self-test harness and the function-per-check, pass/fail-counter style of the existing test pipeline, which these new checks join.

## Out of Scope

- **Adding the pi harness module.** pi is committed but a separate follow-up effort; this work only leaves a clean module-shaped slot for it.
- **Deciding whether to remove oh-my-pi.** Decoupled from this work — the pollution concern that motivated it is resolved by the isolation guarantee, so the keep/drop call is made later on usage merits.
- **VM sandboxing (Gondolin / pi-gondolin).** Tier D is an orthogonal, pi-only isolation layer, not part of the policy contract; building it is out of scope.
- **Building the declarative / sandbox / guidance adapters (tiers C/D/E).** Defined in the model so future harnesses map to them; not implemented now (current harnesses are tiers A and B).
- **Changing skills, commands, agents, or advisory rules.** They already share cleanly and are untouched except for any move required by the modular layout.
- **Output redaction / post-call mutation.** A separate concern from the block/allow guard decision; not reworked here.

## Further Notes

- The two invariants are intended to travel together as the backbone of the fleet: **coverage** (conformance) answers "is every harness safe enough?", **isolation** answers "is every harness only running what I gave it?". Neither is meaningful alone.
- ADR-0011 deliberately reverses the earlier decoupling decision (ADR-0004, pillars 1–2). The earlier decision was correct against its only alternative at the time (a brittle config-translating sync script); the new third path — share the detection logic, project only the transport — is what makes consolidation viable now.
- The enforcement-tier model is the maintainability hedge against "arbitrary future harnesses": a new harness is classified into an existing tier and gets a thin adapter, rather than triggering a redesign. New archetypes are added only when a genuinely novel enforcement model appears, and are then reusable.
