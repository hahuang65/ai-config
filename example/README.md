# Legacy build example

This directory preserves one complete run of the former four-phase build pipeline.
It is a historical sample, not a template for current artifacts.

## Contents

```text
example/
├── CONTEXT.md
└── docs/
    ├── adr/
    │   ├── 0001-idempotency-key-storage.md
    │   ├── 0002-linear-order-state-machine.md
    │   └── 0003-at-least-once-event-delivery.md
    └── features/20260516-1430-order-placement/
        ├── prd.md
        ├── prd.html
        ├── tasks.md
        ├── tasks.html
        └── diff-review.html
```

The example predates these current conventions:

- Conditional UI design produces canonical `mockups.html` before the Spec when relevant.
- The Spec is canonical `specs.html`, not a Markdown PRD with an HTML companion.
- Tasks are canonical `tasks.html`, not Markdown with an HTML companion.
- Mandatory Review change follows implementation and produces a disposable report.

See the root [`README.md`](../README.md) and [`skills/build/SKILL.md`](../skills/build/SKILL.md) for the current pipeline.

## Historical artifacts

### Domain model and decisions

- [`CONTEXT.md`](CONTEXT.md) records the example's Commerce language.
- [`ADR-0001`](docs/adr/0001-idempotency-key-storage.md) selects Redis-backed idempotency keys.
- [`ADR-0002`](docs/adr/0002-linear-order-state-machine.md) defines the Order state machine.
- [`ADR-0003`](docs/adr/0003-at-least-once-event-delivery.md) selects at-least-once events with idempotent consumers.

### Former feature pipeline

- [`prd.md`](docs/features/20260516-1430-order-placement/prd.md) is the former Markdown source.
- [`prd.html`](https://hahuang65.github.io/ai-config/example/docs/features/20260516-1430-order-placement/prd.html) is its former visual companion.
- [`tasks.md`](docs/features/20260516-1430-order-placement/tasks.md) contains six vertical slices.
- [`tasks.html`](https://hahuang65.github.io/ai-config/example/docs/features/20260516-1430-order-placement/tasks.html) is its former visual companion.
- [`diff-review.html`](https://hahuang65.github.io/ai-config/example/docs/features/20260516-1430-order-placement/diff-review.html) is the former implementation review.

These filenames remain unchanged so the example accurately records the old workflow.
Do not copy them into a current Feature directory.

## View the archived HTML

```sh
open example/docs/features/20260516-1430-order-placement/prd.html       # macOS
xdg-open example/docs/features/20260516-1430-order-placement/prd.html  # Linux
```
