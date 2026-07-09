# Consolidate Refactor & Cleanup — Tasks

Source PRD: [prd.md](./prd.md)

Every slice is RED-first against the content-check pipeline: update the checks, watch them fail, then edit the component markdown until the full gate passes. The glossary entries (Hygiene sweep, Directed refactor) and ADR-0015 already landed during the grill session — no slice re-creates them.

## Slice 1: Hygiene mode in the refactorer engine

**Status:** ✅ Complete
**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 5, 6, 7, 12
**Test surface:** The content-check phase for the refactorer agent definition, run via the content gate

### What to build

The refactorer agent definition gains its second entry mode. The mode switch is input-driven: a numbered transformation plan → plan mode (existing behavior, untouched); a changed-file list with no plan → hygiene mode. Hygiene mode's duties are the union of the two retired cleaners: dead-code detection and removal, unused import and unused dependency cleanup, duplicate consolidation into existing helpers, simplification, and language-idiom fixes. Risk policy: SAFE changes applied directly with grep verification and a test run per batch; CAREFUL and RISKY findings reported, never auto-applied. The safety rules state once that the engine never commits in either mode, and note that SAFE/CAREFUL/RISKY means deletion risk in hygiene mode and transformation risk in plan mode.

### Acceptance criteria

- [x] New content checks assert both mode names, the hygiene duties, the SAFE-apply/CAREFUL-report policy, and never-commit — and fail before the agent edit (RED observed: 5 failures)
- [x] The agent definition satisfies the new checks; plan-mode wording (baseline tests, revert protocol, test-preservation rules) is unchanged
- [x] The coach-mode contract is expressible: hygiene findings can be surfaced for user decision while mechanical fixes apply directly
- [x] The full gate passes

> **Deviation:** two pre-existing failures unrelated to this feature (the install-behavior checks expect a pi subagent extension source that isn't in the repo yet, and the meta-suite's valid-repo check cascades from them). Verified pre-existing via stash on the pristine tree. Content, guard, and all other meta checks pass.

---

## Slice 2: Review chain collapses to one Refactor step

**Status:** ✅ Complete
**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 1, 2, 5, 6
**Test surface:** The implement and implement-coach phase checks (which gather the review chain transitively), run via the content gate

### What to build

The review chain's "Clean up" and "Refactor cleanup" steps become a single step named "Refactor" that dispatches the refactorer engine in hygiene mode on the changed files, with no approval gate. The step's wording carries the coach-mode split: mechanical fixes applied directly, CAREFUL/RISKY judgment calls surfaced to the user. Later steps renumber. The implement, implement-coach, and build orchestrator skills describe the new chain shape. After this slice the two retired components still exist on disk but nothing in the chain invokes them.

### Acceptance criteria

- [x] The implement and implement-coach phase checks require the refactorer engine and hygiene wording where they previously required the two retired names — and fail before the chain edit (RED observed: 4 failures)
- [x] The review chain reference has exactly one cleanup step, numbered correctly, invoking the engine in hygiene mode
- [x] The implement, implement-coach, and build skills reflect the 8-step chain
- [x] The full gate passes

> **Deviation:** the implement, implement-coach, and build guide.html chain rows were updated in this slice rather than Slice 3 — the guide/skill sync check requires any backticked agent in a SKILL.md to appear in its guide, so deferring them would have broken the gate at the slice boundary.

---

## Slice 3: Retire the cleaners and purge every reference

**Status:** ✅ Complete
**Type:** AFK
**Blocked by:** Slice 2
**User stories covered:** 7, 8, 9, 11
**Test surface:** Rejection and absence assertions in the content gate, plus the cross-ref agent-existence check and the meta-suite

### What to build

The code-cleaner skill and the refactor-cleaner agent are deleted — the contradictory commit instruction dies with them. Rejection assertions in the content pipeline fail if either retired name reappears in gathered pipeline content; absence assertions fail if the retired skill directory or agent file returns. Every remaining prose reference is rewritten to the new shape: the improve-codebase boundary note points at the hygiene sweep, and the repo README, example README, authoring contract, and the visual guide companions describe one engine with two modes.

### Acceptance criteria

- [x] Rejection assertions for both retired names fail while the references still exist (RED observed: 10 failures, including the refactorer agent's own wording)
- [x] Absence assertions cover the retired skill directory and agent definition
- [x] The cross-ref check finds no dangling agent references
- [x] A repo-wide search for either retired name matches only historical records (feature docs, ADRs, git history) plus the glossary's deliberate avoid-list entries
- [x] The meta-suite still passes (the pipeline still catches planted errors)
- [x] The full gate passes

---

## Slice 4: Goal-specificity routing in the refactor skill

**Status:** ✅ Complete
**Type:** AFK
**Blocked by:** Slice 1 (hygiene mode must exist to dispatch); independent of Slices 2–3
**User stories covered:** 3, 4, 10
**Test surface:** The refactor-skill content checks, run via the content gate

### What to build

The refactor skill routes by goal specificity instead of rejecting vague goals. A specific structural goal takes the existing path unchanged: analyze, plan, wait for explicit approval, execute via plan mode. A vague goal ("clean up X") skips the plan interview and dispatches the engine in hygiene mode on the named area, with the SAFE-apply/CAREFUL-report contract. The skill's wording uses the glossary terms — directed refactor for the gated path, hygiene sweep for the plan-less one.

### Acceptance criteria

- [x] Content checks assert the routing rule (vague → hygiene dispatch, specific → plan gate) — and fail before the skill edit (RED observed: 4 failures)
- [x] The "Wait for the user" approval assertions on the plan path still pass unchanged ("Do NOT proceed without explicit user approval" pinned by the new checks)
- [x] The former reject-vague-goals rule is gone; the skill names both glossary terms
- [x] The full gate passes

## Verification Summary

Fact-checked 2026-07-09 against the implemented working tree (branch `refactor/consolidate-refactor-cleanup`).

- **Claims checked:** 12 (per-slice RED failure counts, gate results, deletion/purge claims, deviation notes, dependency claims).
- **Confirmed:** 12 — RED counts match the observed runs (Slice 1: 5, Slice 2: 4, Slice 3: 10, Slice 4: 4); all four slices marked complete with every acceptance criterion checked; the retired names survive only in historical records, the glossary's deliberate avoid-lists, and the detector script; both deviation notes (pre-existing pi-subagent install failures; guides updated in Slice 2 for the sync check) verified accurate.
- **Corrected:** none.
- **Unverifiable:** none.
