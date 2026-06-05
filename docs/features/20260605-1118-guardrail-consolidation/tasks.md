# Guardrail Consolidation — Tasks

Source PRD: [prd.md](./prd.md)

Most slices apply an **already-established pattern** — a guardrail policy flowing registry entry → guard-core detector → both adapters (which already route the core) → unit tests → the conformance matrix (which auto-covers via the registry's `example`) → the old rule file deleted. The two slices that aren't "just add a policy" are the **content extension** (slice 1, the one new capability) and the **`no-git-destructive` reconciliation** (slice 3). The gate finalization (slice 5) lands last, once no rule carries the retired stream-rule frontmatter.

---

## Slice 1: `no-hardcoded-secret` — content inspection, end-to-end

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 9, 10, 11, 17
**Status:** ✅ Complete

### What to build

The one new capability. The normalized tool call grows a **`content`** field (the write/edit payload), and both adapters forward it. A new floor **guardrail policy**, `no-hardcoded-secret`, inspects that content for a secret literal matched by **known credential formats** and refuses the write. `security.md` is split: its hardcoded-secret pattern leaves; the four fuzzy anti-patterns and the always-on principles remain as the advisory `security` rule (its retired stream-rule frontmatter removed).

### Acceptance criteria

- [x] The normalized tool call carries write/edit `content`; both the tier-A and tier-B adapters forward it, detection stays in the guard core.
- [x] `no-hardcoded-secret` is a floor policy in the registry with intent, a violating `example`, and a benign `counterExample`.
- [x] Writing a high-confidence secret literal (provider key prefix, AWS access-key shape, PEM private-key header) is refused on **both** harnesses; the refusal reason names the right approach (use an env var / secrets manager).
- [x] A placeholder (e.g. an obvious dummy key) and ordinary prose that merely mentions a key do **not** fire — the false-positive boundary.
- [x] Guard-core unit tests cover the positive and both negative cases through the single evaluate entry point.
- [x] `rules/security.md` remains as advisory only (fuzzy anti-patterns + principles), with no stream-rule frontmatter; the conformance matrix shows `no-hardcoded-secret` covered on both harnesses.

---

## Slice 2: Migrate `no-shell-write` (the lone non-floor policy)

**Type:** AFK
**Blocked by:** None
**User stories covered:** 8, 12
**Status:** ✅ Complete

### What to build

A guardrail policy that refuses shell-redirect file writes (output redirected or `tee`'d into a real file), while leaving the safe device targets alone. It is registered **non-floor** — it guards approval *visibility*, not an irreversible action — which makes it the conformance discriminator that proves the floor/non-floor distinction still works once `no-force-push` is gone.

### Acceptance criteria

- [x] `no-shell-write` is a guardrail policy in the registry, flagged **non-floor**, with `example` + `counterExample`.
- [x] A shell-redirect write to a real file is refused on both harnesses; redirects to the standard device targets (null/stderr/stdout, FD merges) are allowed.
- [x] The refusal reason directs the agent to the write/edit tool instead.
- [x] Guard-core unit tests cover positive and negative cases.
- [x] The migrated rule file is deleted; the conformance matrix shows it covered but listed as a non-floor (allowed-gap-eligible) policy.

---

## Slice 3: `no-git-destructive` absorbs `no-force-push`

**Type:** AFK
**Blocked by:** Slice 2
**User stories covered:** 7, 11, 12
**Status:** ✅ Complete

### What to build

Broaden the existing `no-force-push` guardrail into `no-git-destructive`, covering force-push, hook/signature-bypass flags, hard reset, force-clean, and amending a pushed commit — and promote it to the **floor**. The standalone `no-force-push` policy is removed, and the conformance test's non-floor discriminator shifts from it to `no-shell-write` (hence the dependency on slice 2).

### Acceptance criteria

- [x] `no-git-destructive` is a floor policy whose detector refuses force-push (all flag forms), `--no-verify`/`--no-gpg-sign`, hard reset, force-clean, and amend-a-pushed-commit.
- [x] The standalone `no-force-push` policy is removed; nothing references it.
- [x] The conformance suite's non-floor exemplar is now `no-shell-write`; the "floor gap fails / non-floor gap allowed" behavior still holds.
- [x] Both harnesses refuse the destructive git commands; the refusal reason names the right approach (new commit / ask the user).
- [x] Guard-core unit tests cover the broadened command set; the migrated rule file is deleted.

---

## Slice 4: Migrate the five destructive-command policies

**Type:** AFK
**Blocked by:** None
**User stories covered:** 1, 2, 3, 4, 5, 6, 10, 11, 17
**Status:** ✅ Complete

### What to build

Five homogeneous command-pattern guardrail policies, each a detector over the normalized command, all **floor**: cloud teardown, autonomous deploys, database mutation via a CLI, raw-disk `dd`, and broad recursive `chmod`. Each follows the established migration path end-to-end and carries its "right approach" guidance in its refusal reason. The conformance matrix auto-covers all five via their registry examples.

### Acceptance criteria

- [x] `no-cloud-destroy`, `no-deploy`, `no-db-mutation`, `no-dd-disk`, and `no-broad-chmod` are each floor policies in the registry with `example` + `counterExample`.
- [x] Each refuses its dangerous command shape on both harnesses and allows a benign near-miss; the refusal reasons direct the agent to hand off / produce a plan / use the right tool.
- [x] Guard-core unit tests cover each policy's positive and negative cases.
- [x] The five migrated rule files are deleted; the conformance matrix shows all five covered on both harnesses, no gaps.

---

## Slice 5: Retire TTSR in the gate; final advisory-only sweep

**Type:** AFK
**Blocked by:** Slices 1, 2, 3, 4
**User stories covered:** 13, 14, 15, 18
**Status:** ✅ Complete

### What to build

Finalize the retirement. The validation pipeline's stream-rule-frontmatter check is replaced by an assertion that **no** rule carries the retired frontmatter, so a re-introduced enforcement rule fails the gate. Confirm `rules/` is advisory-only and the whole gate (including the self-test) stays green. Claude's static deny patterns are deliberately left unchanged as defense-in-depth.

### Acceptance criteria

- [x] The pipeline asserts no `rules/*.md` carries stream-rule frontmatter; planting one fails the gate (covered by the pipeline self-test).
- [x] `rules/` contains only advisory rules (`coding-style`, `testing`, `performance`, `git-commit`, `mise`, `security`); each still carries the metadata the rulebook needs.
- [x] The full validation pipeline and the self-test are green.
- [x] Claude's static `settings.json` deny patterns are unchanged.
