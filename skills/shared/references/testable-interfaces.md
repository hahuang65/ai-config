# Testable Interfaces Protocol

Shared reference for `/specs`, `/tasks`, `/implement`, and `/implement-coach`. It carries one testing decision through the build pipeline: **test the stable public interface of a deep module, not every implementation piece that changes behind it.**

## Core principle

A deep module hides a lot of behavior behind a small, stable, testable interface. That interface is the test seam. Tests should pin what callers can observe through that seam while leaving the implementation free to change.

Do not ask the user, "Which modules should have tests written for them?" The pipeline already answers that: behaviors delivered through stable public interfaces need tests. Ask the user only to correct the module boundary or public-interface choice.

## Default test-surface decision

Use this default unless the codebase's testing rule or an ADR says otherwise:

1. **Test user-visible behavior through the highest stable public interface** available for the slice: API endpoint, CLI command, UI/component contract, exported service API, job entry point, or guard/tool adapter.
2. **Direct-test a lower-level module only when it is deep in its own right**: non-trivial behavior, reusable across callers, and a small public interface that is not adequately exercised by the higher-level test or needs fast/exhaustive edge-case coverage.
3. **Do not direct-test shallow pass-throughs** just because they changed. Controllers, adapters, serializers, docstrings, mocks, private helpers, and plumbing are usually covered by the owning public-interface test unless they themselves are the public interface.
4. **Do not list test artifacts as product modules.** A spec file, fixture, or mock is not a module in the spec module sketch. It belongs in Testing Decisions or in a task's test surface.
5. **Do not test pure documentation follow-ups in the product repo.** If the requested work is "document this in another repo" or "follow up later," record it as out of scope or a follow-up, not as a CRM implementation module needing tests.

## How the decision moves through the pipeline

### `/specs`

Sketch production modules and their test surface together. For each module, classify one of:

- **Test directly through `<public interface>`** — the module is the seam callers use.
- **Covered through `<higher-level interface>`** — changed behind the seam; no separate direct tests unless implementation reveals a need.
- **No product test** — documentation/follow-up/scaffolding only; explain why.

The spec's Testing Decisions section records this plan. If the user simply confirms the module sketch, keep the proposed test plan; do not ask them to choose test ownership from scratch.

### `/tasks`

Each vertical slice carries the test surface forward. Acceptance criteria describe observable behavior, and the slice includes a concise **Test surface** line naming the public interface the first RED test should exercise. Never create a horizontal slice whose only deliverable is "write specs"; tests are part of each vertical slice.

### `/implement`

Before a slice's first RED test, confirm or refine the public interface from the task's Test surface and the spec's Testing Decisions. Write one behavior test through that interface. Add lower-level tests only when the deep-module rule above applies or the RED/GREEN cycle reveals an uncovered edge case.

### `/implement-coach`

Same as `/implement`, except the AI writes one test and the user writes the implementation. The interface confirmation is about the public seam, not whether tests are needed. Never queue extra tests or turn internals into direct-test targets merely because they are visible while coaching.
