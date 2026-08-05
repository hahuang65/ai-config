# TDD Protocol

Shared reference for `code` and `coach`. Both run strict vertical-slice TDD — the only difference is who writes the implementation code (the AI in `/code`; the user in `/coach`).

## Philosophy

**Vertical-slice TDD** — one test, one implementation, repeat. Each test responds to what you learned from the previous cycle. Do NOT write all tests upfront, then all implementation.

**Good tests** verify behavior through public interfaces. They read like specifications — *what* the system does, not *how*. They survive refactors because they don't care about internal structure. Use [testable-interfaces.md](testable-interfaces.md) to decide which public interface owns a behavior test.

**Bad tests** couple to implementation: they mock internal collaborators, test private methods, or verify through side channels. Warning sign: a test that fails when you rename an internal function despite identical behavior.

## The pattern

```
RIGHT (vertical):
  RED→GREEN: test1 → impl1   (one test, minimal code to pass)
  RED→GREEN: test2 → impl2   (next test, minimal code to pass)
  (refactor between cycles, only while GREEN)
```

```
WRONG (horizontal):
  RED:   test1, test2, test3, test4, test5
  GREEN: impl1, impl2, impl3, impl4, impl5
```

Tests written in bulk test *imagined* behavior, not *actual* behavior. They check the shape of things — data structures, signatures — rather than user-facing behavior. Reject this anti-pattern.

## Per-cycle rules

- **One test at a time.** Only enough code to pass the current test.
- **Don't anticipate future tests.** Write code for what the current test needs, nothing more.
- **Tests exercise the public interface**, never internal state.
- **Tests use the ubiquitous language from applicable context files** — `it("cancels an Order", ...)`, not `it("calls cancelOrder()", ...)`.
- **Refactor only while GREEN.** Get to GREEN first, then extract duplication, deepen modules, apply SOLID where natural. Run tests after every refactor step.

## Deep modules

Before writing a slice's first test, confirm its public interface from the slice's Test surface and the spec's Testing Decisions. Prefer [deep modules](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/deep-modules.md) — a small interface over a deep implementation. The interface is what tests exercise; everything behind it is free to refactor. Do not ask whether tests are needed; ask only if the public-interface seam itself is ambiguous or seems wrong.

## Per-slice checklist

Before marking a slice complete:

- [ ] Every test describes behavior, not implementation
- [ ] Every test uses the public interface only
- [ ] Every test would survive an internal refactor
- [ ] The code is minimal for the tests it satisfies
- [ ] No speculative features added beyond the acceptance criteria

Then mark the slice complete in canonical `tasks.html`: change every criterion's visible and `data-status` state to `complete`, and change the slice's visible and `data-status` state to `complete`.

## Handling issues

- **Minor issues:** fix and continue. Note the deviation in the slice body.
- **A slice can't be implemented as written:** STOP. Surface the issue and wait for guidance.
- **Test failures during refactor:** revert the refactor step — refactoring must not change behavior.
