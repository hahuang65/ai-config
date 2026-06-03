# Order Placement — Tasks

Source PRD: [prd.md](./prd.md)

Six vertical-slice tracer bullets. Each cuts through every layer end-to-end and is demoable on its own. Slices are ordered by dependency — finish slice N before starting slice N+1 unless explicitly unblocked.

---

## Slice 1: Customer can place an Order (happy path)

**Type:** AFK
**Blocked by:** None — can start immediately
**User stories covered:** 1, 8, 10, 12

### What to build

A Customer with a valid Cart and an `Idempotency-Key` header can POST to the order placement endpoint and receive a `201` with the new Order ID and status. The Order is persisted with `pending` status and OrderLines. After the row is committed, `OrderPlaced` is emitted with the Order's `total`, `customer_id`, and `event_id`.

### Acceptance criteria

- [ ] Returns `201` with `{ order_id, status: "pending" }` for a valid request
- [ ] Persists Order row with `pending` status before the response returns
- [ ] Persists OrderLine rows with frozen prices snapshotted from Catalog
- [ ] Emits `OrderPlaced` event AFTER the Order row commits — never before
- [ ] `OrderPlaced` payload includes `event_id` (ULID), `order_id`, `customer_id`, `total`, `occurred_at`
- [ ] Returns `400` for an empty Cart
- [ ] Returns `400` for a missing `Idempotency-Key` header

---

## Slice 2: Idempotency-Key dedupes retries

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 2, 3, 13

### What to build

A retry of the same request with the same `Idempotency-Key` returns the original Order ID without re-persisting and without re-emitting `OrderPlaced`. The IdempotencyStore lives in Redis with a 24-hour TTL per ADR-0001. A Redis outage degrades to "duplicates possible" — checkout stays available; the idempotency guarantee is best-effort.

### Acceptance criteria

- [ ] Second request with same `(customer_id, idempotency_key)` returns the same `order_id` as the first
- [ ] Second request does NOT persist a duplicate Order row
- [ ] Second request does NOT emit a second `OrderPlaced`
- [ ] After 24 hours, the same key creates a new Order (TTL works as expected)
- [ ] Two different Customers using the same `idempotency_key` get two distinct Orders (per-Customer scoping)
- [ ] When Redis is unreachable, the endpoint still returns `201` for valid requests (logs a warning; metric incremented)
- [ ] Idempotency hit rate exposed as a Prometheus counter

---

## Slice 3: Customer can see their Order history

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 4, 7

### What to build

A GET endpoint that returns the requesting Customer's Orders, sorted by `created_at` descending, with status. Cursor-paginated. A Customer cannot read another Customer's Orders.

### Acceptance criteria

- [ ] Returns `200` with the Customer's Orders for an authenticated request
- [ ] Orders are sorted by `created_at` descending
- [ ] Each entry includes `order_id`, `status`, `total`, `created_at`, `order_lines[]`
- [ ] Supports cursor pagination (`?cursor=<opaque>&limit=<n>`)
- [ ] Returns `200` with empty array for a Customer with no Orders (NOT `404`)
- [ ] Returns `403` when a Customer attempts to read another Customer's Orders by ID
- [ ] N+1 queries on OrderLines avoided (single query with join, or batched fetch)

---

## Slice 4: Customer can cancel a pending Order

**Type:** AFK
**Blocked by:** Slice 1
**User stories covered:** 5, 6, 9

### What to build

A POST to the cancel endpoint transitions a `pending` Order to `canceled` and emits `OrderCanceled`. A cancel attempt on `confirmed` returns `409` with an error code the UI maps to "contact support" (per ADR-0002, refunds are Billing's concern).

### Acceptance criteria

- [ ] Returns `200` with `{ status: "canceled" }` when transitioning from `pending`
- [ ] Persists status change before response
- [ ] Emits `OrderCanceled` event with same payload shape as `OrderPlaced`
- [ ] Returns `409` with error code `ORDER_NOT_CANCELLABLE` when called on a `confirmed` Order
- [ ] Returns `409` when called on an already-`canceled` Order (idempotency on the resource itself)
- [ ] Returns `403` when one Customer tries to cancel another Customer's Order
- [ ] No state transition from `confirmed → canceled` is possible (state machine is linear per ADR-0002)

---

## Slice 5: Downstream consumer contract sign-off

**Type:** HITL — requires design review with Fulfillment and Billing teams
**Blocked by:** Slice 1 (event payload must exist), Slice 4 (cancel event must exist)
**User stories covered:** 8, 9, 10, 11

### What to build

A short design-review session with the Fulfillment and Billing teams to ratify the `OrderPlaced` and `OrderCanceled` payload contracts, confirm the at-least-once delivery expectations (per ADR-0003), and agree on the `event_id` deduplication strategy in each consumer. Publish the agreed contracts in `docs/events/commerce.md` and link from the PRD.

### Acceptance criteria

- [ ] Meeting held with Fulfillment lead and Billing lead
- [ ] Event payload schemas published in `docs/events/commerce.md`
- [ ] Both consumers confirm they will dedupe on `event_id`
- [ ] Both consumers confirm they will retry forever on transient processing failures (no DLQ for transient errors)
- [ ] Edge case discussed: what does Fulfillment do if `OrderCanceled` arrives before `OrderPlaced` was processed? (Answer documented.)

---

## Slice 6: Telemetry and observability

**Type:** AFK
**Blocked by:** Slices 1, 2, 3, 4
**User stories covered:** 13 (operationally — exposing the Redis outage state)

### What to build

Structured logging on every Commerce endpoint with `customer_id`, `order_id`, `idempotency_hit`, and latency. Prometheus metrics for: requests by endpoint, status code distribution, idempotency hit rate, event-publish latency, event-publish failure count. Grafana dashboard updated to surface these.

### Acceptance criteria

- [ ] Every Commerce endpoint emits a structured log on success and failure
- [ ] PII (Customer email, address) is redacted from logs per the security rule
- [ ] Idempotency hit rate counter increments correctly on a hit and not on a miss
- [ ] Event-publish failure metric increments on a broker outage (verified via fault injection)
- [ ] Grafana panel added for idempotency hit rate, alarming below 50% for 10 minutes (catches a Redis outage)
- [ ] Runbook entry added: "Commerce idempotency hit rate dropped" → check Redis health
