# Example: /build Artifacts

Historical sample artifacts from a complete `/build` run that predates the current five-phase pipeline.
The example feature is **customer-facing order placement with idempotency, order history, cancellation, and at-least-once event emission for downstream consumers**.

The tree preserves every artifact the former pipeline produced; the current-pipeline comparison follows it:

```
example/
├── CONTEXT.md                          # repo-root analog — domain glossary
│                                         (built up by /grill)
├── docs/
│   ├── adr/                            # repo-root analog — ADRs
│   │   ├── 0001-idempotency-key-storage.md
│   │   ├── 0002-linear-order-state-machine.md
│   │   └── 0003-at-least-once-event-delivery.md
│   └── features/
│       └── 20260516-1430-order-placement/
│           ├── prd.md                  # Phase 2 — PRD (user stories + decisions)
│           ├── prd.html                # Phase 2 — visual companion
│           ├── tasks.md                # Phase 3 — vertical-slice tracer bullets
│           ├── tasks.html              # Phase 3 — visual companion
│           └── diff-review.html        # Legacy Phase 4 review artifact
└── README.md                           # this file
```


> **Naming note:** this example was generated before the `prd` skill was renamed to `spec` — its artifacts keep their original `prd.md` / `prd.html` filenames as a historical record. The current pipeline writes canonical `specs.html` with no Markdown companion.

## Historical Pipeline Overview

```
/build "Add customer-facing order placement"

Phase 1: /grill     → CONTEXT.md (glossary)
                       docs/adr/ (decisions)
Phase 2: /prd       → prd.md + prd.html
                       (↻ // annotation cycles)
Phase 3: /todo     → tasks.md + tasks.html
                       (↻ quiz-the-user cycles)
Phase 4: /code → code + diff-review.html
        (vertical-slice TDD, one slice at a time)
```

The current pipeline instead ends implementation after full verification and hygiene, then runs the mandatory Review change gate:

```
Phase 1: /grill         → CONTEXT.md + ADRs
Phase 2: /spec          → canonical specs.html + review-artifact approval
Phase 3: /todo          → canonical tasks.html + review-artifact approval
Phase 4: /code|/coach   → vertical-slice TDD + verification + hygiene
Phase 5: /review-change → adversarial review + evidence + docs + lint + final report
```

## Phase 1: Grill — Domain Modeling

The grilling session interviews the user, sharpens terminology, and records hard-to-reverse decisions. Output is project-wide, NOT feature-scoped: `CONTEXT.md` accretes vocabulary, `docs/adr/` accretes architectural decisions.

| File | Description |
|------|-------------|
| [CONTEXT.md](CONTEXT.md) | Domain glossary for the Commerce context — Customer, Cart, Order, OrderLine, IdempotencyKey, OrderStatus, OrderPlaced, OrderCanceled. Definitions are tight; aliases are listed under `Avoid`. Includes an example dialogue resolving an ambiguity. |
| [docs/adr/0001-idempotency-key-storage.md](docs/adr/0001-idempotency-key-storage.md) | Redis with 24h TTL over Postgres column. Why: native TTL, ~1ms hits, graceful degradation. |
| [docs/adr/0002-linear-order-state-machine.md](docs/adr/0002-linear-order-state-machine.md) | `pending → confirmed` or `pending → canceled`. No back-transitions. Refunds are a Billing concern, not Commerce. |
| [docs/adr/0003-at-least-once-event-delivery.md](docs/adr/0003-at-least-once-event-delivery.md) | At-least-once delivery with idempotent consumers. Exactly-once across processes is a fairytale. |

## Phase 2: PRD — Synthesizing the Spec

The PRD transcribes the grilling outcome into a durable spec. No code snippets, no file paths — those go stale. The PRD focuses on user stories, decisions, and testing notes.

| File | Description |
|------|-------------|
| [prd.md](docs/features/20260516-1430-order-placement/prd.md) | Problem statement, solution, 13 user stories (across Customer, Fulfillment, Billing, SRE actors), implementation decisions (module sketch + choices with ADR links), testing decisions, out-of-scope notes, further notes. |
| [prd.html](https://hahuang65.github.io/ai-config/example/docs/features/20260516-1430-order-placement/prd.html) | Visual companion — user stories as actor-color-coded cards, module sketch with deep-module tagging, decision list with ADR badges, out-of-scope panel. |

The PRD goes through `//` annotation cycles until the user explicitly approves. Each cycle: user adds inline `//` comments → agent addresses every note → updates the markdown → removes the comments → regenerates the visual.

## Phase 3: Tasks — Vertical-Slice Breakdown

Tasks break the PRD into vertical-slice tracer bullets. Each slice cuts through every layer (schema, API, business logic, UI, tests) and is demoable on its own. **Horizontal slices** ("set up the schema first") are rejected.

| File | Description |
|------|-------------|
| [tasks.md](docs/features/20260516-1430-order-placement/tasks.md) | Six slices: place Order, idempotency, history, cancel, downstream contract sign-off (HITL), telemetry. Each marked HITL or AFK with dependency order and acceptance criteria. |
| [tasks.html](https://hahuang65.github.io/ai-config/example/docs/features/20260516-1430-order-placement/tasks.html) | Visual companion — SVG dependency graph, summary pills (6 slices, 5 AFK, 1 HITL), per-slice cards with HITL/AFK markers and acceptance-criteria checklists. |

The user approves the breakdown via a lighter quiz-the-user cycle (granularity? dependencies? HITL/AFK split? story coverage?) — no inline annotations needed at this stage.

## Phase 4: Implement — Vertical-Slice TDD

Implementation walks through the slices one at a time using strict red-green-refactor — one test, one implementation, repeat. Batched tests describe imagined behavior, not actual behavior; they're rejected as an anti-pattern.

| File | Description |
|------|-------------|
| [diff-review.html](https://hahuang65.github.io/ai-config/example/docs/features/20260516-1430-order-placement/diff-review.html) | Post-implementation visual: executive summary, KPI dashboard (6/6 slices complete, 47 tests added, 94% coverage), slice completion status, file-by-file changes, code review findings (Good / Fixed-before-merge / Tracked follow-ups), decision log, re-entry context. |

This legacy example predates Review change and shows the former implementation-owned review artifact. The current pipeline keeps TDD, full verification, and the `refactorer` hygiene sweep in implementation, then delegates final validation and artifact synchronization to Review change. The agent **never** runs `git commit` — the user reviews the final state and commits when ready.

## Key Conventions

- **Repo-root vs per-feature**: `CONTEXT.md` and `docs/adr/` live at the repo root and accrete across many `/build` runs. Current per-feature spec and task artifacts live under `docs/features/<YYYYMMDD-HHMM>-<slug>/`; the archived example also contains the former diff review.
- **Legacy companion naming**: this archived example pairs Markdown with HTML (`prd.md` → `prd.html`, `tasks.md` → `tasks.html`). The current pipeline uses canonical `specs.html` and `tasks.html` without Markdown companions.
- **Canonical sync**: Review change cold-fact-checks the final canonical HTML in place. The archived artifacts reflect the older companion-regeneration behavior.
- **No code in the PRD**: code snippets and file paths go stale; the PRD is durable spec. Narrow exception: decision-rich snippets (state machines, schemas) may be inlined when prose can't carry the precision.
- **Vertical, never horizontal**: every task slice cuts through every layer end-to-end and is demoable on its own. Many thin slices beat few thick ones.
- **CONTEXT.md vocabulary everywhere**: terms resolved during grill appear unchanged in the PRD, tasks, test names, and code identifiers.

## How to View

Open any `.html` file directly in a browser:

```bash
open example/docs/features/20260516-1430-order-placement/prd.html       # macOS
xdg-open example/docs/features/20260516-1430-order-placement/prd.html  # Linux
```

The HTML files support both light and dark mode via `prefers-color-scheme` and use IBM Plex Sans/Mono.
