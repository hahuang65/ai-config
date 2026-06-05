# Modular Harness Config & Shared Guardrails — Tasks

Source PRD: [prd.md](./prd.md)

The breakdown has two independent roots — the **guardrail spine** (Slice 1 → 3 → {4, 5}) and the **isolation track** (Slice 2) — that converge on the **module restructure** (Slice 6). Each slice cuts end-to-end: a guardrail policy flows registry → guard core → both harness adapters → conformance/isolation coverage → installed and verified, rather than building one layer at a time.

---

## Slice 1: Tracer bullet — one floor policy enforced in both harnesses through the shared guard core

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 9, 10, 11, 12, 13, 14, 15
**Status:** ✅ Complete

### What to build

The thinnest complete path. Introduce the **policy registry** with a single canonical entry (`no-secret-access`, flagged floor) and the **guard core** with a harness-neutral tool-call shape and one `evaluate` entry point that detects secret access. Wire both in-scope harnesses to that same core: **oh-my-pi** runs it in-process (enforcement tier A); **Claude Code** invokes it through a thin command-hook shim (tier B) while keeping its static denylist as defense-in-depth. After install, a secret-file read attempted through either harness's tool surface is refused by the same detection logic — no second copy.

### Acceptance criteria

- [x] The policy registry holds `no-secret-access` with its intent and enforcement metadata, including a `floor` flag set true.
- [x] The guard core exposes one `evaluate` over a normalized tool-call shape and returns a block verdict for a secret read (read/edit path or a bash reader), and no verdict for prose merely mentioning a credential path.
- [x] The oh-my-pi adapter blocks the read by routing the call through the guard core, carrying no detection logic of its own.
- [x] The Claude shim normalizes its hook payload, calls the same guard core, and emits Claude's deny verdict; Claude's static denylist remains in place as a second layer.
- [x] Guard-core unit tests cover positive (read tool, bash reader, substitution-wrapped) and negative (prose, benign command) cases for the policy.
- [x] Installing against a temporary home wires both adapters; a simulated secret read is blocked under each harness.

---

## Slice 2: Disable cross-discovery and add the isolation test

**Type:** AFK
**Blocked by:** None — independent of the guardrail spine, can run in parallel
**User stories covered:** 6, 7, 8
**Status:** ✅ Complete

### What to build

Make sharing push-only. Turn off each harness's **cross-discovery** so no harness reads a sibling's config root, and add the **isolation test** asserting every config root contains only its own module's files plus the curated shared set, with no symlink resolving into a sibling harness's source. Back it with a planted-leak fixture so the invariant can't silently pass.

### Acceptance criteria

- [x] oh-my-pi's config disables discovery of the Claude config root (and any other sibling source).
- [x] The isolation test passes on a clean install: each config root equals its module files ∪ the curated shared set.
- [x] The test fails when a sibling-pointing link is planted in a config root, or when a cross-discovery flag is left enabled (test-the-test fixture).
- [x] The isolation test runs as part of the existing test pipeline.

---

## Slice 3: Conformance test, coverage matrix, and the floor discriminator

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 16, 17, 18, 19, 23
**Status:** ✅ Complete

### What to build

Add the **conformance test** that derives the mandatory set by filtering the registry's `floor` flag and asserts every in-scope harness adapter covers every floor policy, emitting a **coverage matrix** of policy × harness. Introduce a second policy, `no-force-push`, flagged non-floor, to prove the filter discriminates: it is covered, but its absence from a harness is an *explicit, allowed* gap rather than a failure. A planted gap on a *floor* policy must fail the test.

### Acceptance criteria

- [x] The registry carries at least two policies with differing `floor` flags (`no-secret-access` floor; `no-force-push` non-floor), both detected by the guard core.
- [x] The conformance test passes when every floor policy is covered by both harnesses, and emits a readable coverage matrix.
- [x] Dropping a floor policy from one harness's coverage fails the test; dropping the non-floor policy does not — it surfaces as an explicit gap in the matrix.
- [x] No silent gaps: a floor policy uncovered for any harness is always a failure (test-the-test fixture).
- [x] The conformance test runs as part of the existing test pipeline.

---

## Slice 4: Consolidate no-curl-pipe-shell across both harnesses

**Type:** AFK
**Blocked by:** Slice 3
**User stories covered:** 20
**Status:** ✅ Complete

### What to build

Fold the curl-piped-to-interpreter guardrail — today implemented **twice**, as an oh-my-pi hook and a separate Claude command hook — into a single registry entry and guard-core detection, flagged floor. Both harnesses route through the core; the two duplicated implementations are deleted. This is the drift poster child from ADR-0011.

### Acceptance criteria

- [x] `no-curl-pipe-shell` exists once in the registry (floor) and once in the guard core, detecting pipe/chain-to-interpreter including no-space and substitution shapes.
- [x] The prior oh-my-pi curl-pipe hook and the prior Claude curl-pipe command hook are both removed; neither harness keeps a second copy of the logic.
- [x] Both harnesses block a curl-piped-to-shell command after install; the coverage matrix shows it covered on both.
- [x] Guard-core unit tests cover the policy's positive and negative cases.

---

## Slice 5: Consolidate no-broad-rm and no-sudo — floor complete

**Type:** AFK
**Blocked by:** Slice 3
**User stories covered:** 20
**Status:** ✅ Complete

### What to build

Migrate the broad-`rm` and `sudo` guardrails from their standalone oh-my-pi hooks into the registry + guard core, both flagged floor, both routed through the core in both harnesses; remove the standalone hooks. Together with `no-secret-access` and `no-curl-pipe-shell`, this completes the four-policy **mandatory floor**, fully covered on both harnesses.

### Acceptance criteria

- [x] `no-broad-rm` and `no-sudo` each exist once in the registry (floor) and once in the guard core.
- [x] The prior standalone oh-my-pi rm and sudo hooks are removed.
- [x] Both harnesses block a broad `rm` and a `sudo` invocation after install.
- [x] The conformance matrix shows all four floor policies covered on both harnesses, no gaps.
- [x] Guard-core unit tests cover both policies' positive and negative cases.

---

## Slice 6: Harness-module restructure and generic install loop

**Type:** HITL — architectural review of the harness-module manifest and install-loop shape
**Blocked by:** Slices 2, 4, 5
**User stories covered:** 1, 2, 3, 4, 5, 21, 22, 24
**Status:** ✅ Complete (design approved: `harnesses/` layout, sourced `manifest.sh`; story 21 deviation noted below)

### What to build

Restructure per-harness config into self-contained **harness modules**, each declaring its config root, the shared categories it consumes, and its guardrail adapter. Rewrite install as a **generic loop** over whatever modules exist — mirroring the curated shared set plus each module's own files into that module's config root, installing the neutral cross-harness instruction source into each root (so no single shared file is slurped by every agent), disabling cross-discovery, and pruning dangling links. Leave a clean, empty module-shaped slot for **pi** without building its enforcement. All prior invariants stay green through the move.

### Acceptance criteria

- [x] Each in-scope harness is a self-contained module (`harnesses/{claude,omp}/manifest.sh`) declaring its config root, consumed shared categories, and adapter.
- [x] Install is a generic loop over modules; adding a module installs a harness and deleting its directory removes one cleanly — verified by `test_install_behavior` against a temporary home (via a `HARNESSES_DIR` override).
- [x] Re-running install is idempotent and prunes dangling links.
- [x] A documented, empty pi-shaped module slot exists (`harnesses/pi/manifest.sh`, `harness_pending=true`); the loop treats it as pending without building enforcement.
- [x] Shared skills, commands, agents, and advisory rules remain flat-shared and unchanged.
- [~] **Deviation (story 21):** the manifest + loop *support* an optional per-root instruction file (`instruction_target`), but it is left **unset**. The repo-root `AGENTS.md` is an in-repo *authoring contract*, not a neutral global instruction — installing it into config roots would pollute every project. Story 21's intent (no single file accidentally slurped) is already met by the existing `rules/` fan-out, which is the real per-project instruction surface. Surfaced to and acknowledged by the user; revisit if a genuinely-neutral source is defined.
- [x] The isolation test, conformance test, and guard-core unit tests all still pass after the restructure.
