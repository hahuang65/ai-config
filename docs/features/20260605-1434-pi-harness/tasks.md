# pi Harness — Tasks

Source PRD: [prd.md](./prd.md)

Filling a **pending harness module** (ADR-0010) with a tier-A guard adapter (ADR-0011/0012) and the one new **rule concatenation** mechanism (ADR-0013). The guard core, conformance/isolation harness, and the generic install loop already exist. Two independent roots (the adapter, the concatenation) converge on the install wiring, which the isolation/install proof then validates.

---

## Slice A: pi enforces the guardrail floor, proven by conformance

**Type:** AFK
**Blocked by:** None — root
**User stories covered:** 1, 2, 3, 4
**Status:** ✅ Complete

### What to build

A **tier-A adapter** for pi — a thin twin of the oh-my-pi adapter that normalizes pi's structured tool-call event and routes it through the shared **guard core**, returning a block verdict with the core's reason. No detection logic of its own. Proven two ways: a pi-adapter unit test (the twin of the existing oh-my-pi-adapter test, driven in-process), and the **conformance test** extended to pi as a third harness so the coverage matrix gains a third column.

### Acceptance criteria

- [x] The pi adapter routes a tool call through the guard core and blocks with the core's reason; it carries no policy logic.
- [x] A pi-adapter unit test drives the adapter in-process with a representative floor violation and asserts it blocks with the right reason.
- [x] The conformance coverage matrix shows a third column for pi; every **mandatory policy floor** guardrail is enforced on pi with no gap.
- [x] A write carrying a hardcoded secret is blocked on pi (the content path works), mirroring the other harnesses.
- [x] The full guard suite is green.

---

## Slice B: rule concatenation + drift gate

**Type:** AFK
**Blocked by:** None — root
**User stories covered:** 5, 6, 11
**Status:** ✅ Complete

### What to build

The new **rule projection** for pi (ADR-0013): a regeneration target that joins the advisory rules (with per-rule headers) into one committed file — pi's future always-on context. A gate **drift-check** regenerates from the canonical rules and fails if the committed file differs, so a forgotten regeneration can't be committed. A self-test fixture proves the gate actually rejects a stale concatenation.

### Acceptance criteria

- [x] A regeneration target produces the committed concatenation from the advisory rules, each section labelled by rule.
- [x] A gate check regenerates and compares; a stale committed file fails the check.
- [x] A pipeline self-test plants a stale concatenation and asserts the pipeline exits non-zero.
- [x] The committed concatenation is present and current; the whole gate is green.

---

## Slice C: fill `install_module` and flip the slot live

**Type:** AFK
**Blocked by:** Slices A, B
**User stories covered:** 5, 7, 9, 10, 12
**Status:** ✅ Complete

### What to build

Turn the pending **harness module** live. The module declares its **consumed categories** as skills, commands, and agents (not rules — those arrive via the concatenation), consumes commands without skill-deduplication, and flips off `pending`. Its `install_module` symlinks the guard adapter into pi's auto-discovered extensions location, installs a repo-managed `settings.json` (provider/model/thinking mirroring the oh-my-pi default), and symlinks the concatenation as pi's always-on context file — so a regenerated file reaches pi live, with the installer run once. Requires the adapter (A) and the concatenation (B) to exist to symlink them.

### Acceptance criteria

- [x] The module consumes skills, commands, and agents; rules are not symlinked as a directory; `pending` is off.
- [x] `install_module` symlinks the guard adapter into pi's extensions location, installs the repo-managed `settings.json`, and symlinks the concatenation as pi's always-on context file.
- [x] A repo-managed `settings.json` exists with a provider/model default mirroring oh-my-pi's, and is user-editable.
- [x] Running the installer scaffolds the pi **config root** fully — skills as `/skill:name`, commands as clean `/name`, the adapter, settings, and the context file all in place.
- [x] Adding pi required no change to the other harness modules.

### Notes

- pi's exact extension event field names, the auto-discovery location, and that write/edit input carries content are **verified during implementation** — the conformance test from Slice A is self-checking, so a mismatch fails loudly rather than silently weakening enforcement.
- The `settings.json` key shape is confirmed against pi's own config (package source / existing pi config) before committing; a wrong shape is caught by the install proof in Slice D.

---

## Slice D: isolation + install proof for the third config root

**Type:** AFK
**Blocked by:** Slice C
**User stories covered:** 8, 12
**Status:** ✅ Complete

### What to build

Prove the **isolation invariant** holds with three harnesses. The isolation test gains pi's config root as a third owned root — it must contain only the pi module's own files plus the curated shared set, with no symlink resolving into a sibling harness. The install-category checks cover the pi module wiring (adapter, settings, and context-file symlink present; rules not symlinked as a directory).

### Acceptance criteria

- [x] The isolation test asserts pi's config root contains only its module's files plus the curated shared set; any leak fails.
- [x] No symlink under pi's config root resolves into a sibling harness's directory; cross-discovery stays off.
- [x] The install-category checks verify the pi module wiring is real (adapter, settings, context-file symlink present; no rules directory).
- [x] The whole gate (`make test`) is green across all three harnesses.
