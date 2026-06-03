# Order Placement — PRD

## Problem Statement

Customers can browse the catalog and add Items to a Cart, but there is no way to convert a Cart into a persisted Order. Without persisted Orders, downstream systems (Fulfillment, Billing) have nothing to consume, Customers have no order history, and retries on flaky mobile connections risk creating duplicate purchases when we eventually wire this up naively.

## Solution

Add a customer-facing order placement endpoint that:

1. Accepts a Cart and produces a persisted Order with `pending` status
2. Deduplicates retries via a client-supplied `Idempotency-Key` (24-hour window, per Customer)
3. Emits `OrderPlaced` for downstream consumers
4. Exposes order history per Customer
5. Allows Customers to cancel their own `pending` Orders before Fulfillment accepts them

Refunds remain entirely out of scope — see ADR-0002. Refunds are a Billing concern.

## User Stories

1. As a Customer, I want to place an Order from my Cart, so that I receive the Items I selected.
2. As a Customer, I want a retried request with the same Idempotency-Key to return the same Order, so that a flaky mobile connection doesn't charge me twice.
3. As a Customer, I want a request without an Idempotency-Key to be rejected, so that the system fails loud rather than silently creating duplicates on retry.
4. As a Customer, I want to see my Order history with current statuses, so that I can confirm what I've purchased and when.
5. As a Customer, I want to cancel a `pending` Order, so that I can change my mind before Fulfillment ships it.
6. As a Customer, I want a cancel attempt on a `confirmed` Order to be rejected with a clear error, so that I know to contact support for a refund (Billing concern, not ours).
7. As a Customer, I want my Order history to be visible only to me, so that another Customer can't read what I bought.
8. As a Fulfillment service, I want an `OrderPlaced` event per new Order, so that I can start picking.
9. As a Fulfillment service, I want an `OrderCanceled` event when an Order is canceled, so that I can halt picking if I haven't shipped yet.
10. As a Billing service, I want `OrderPlaced` with the total and the Customer's identity, so that I can issue an Invoice.
11. As a Billing service, I want every event to carry a stable `event_id`, so that I can dedupe at-least-once deliveries (see ADR-0003).
12. As an SRE, I want orders to persist before events are emitted, so that we never publish an event for an Order that doesn't exist on a partition recovery.
13. As an SRE, I want a Redis outage to degrade idempotency to "duplicates possible" rather than block the entire endpoint, so that an outage doesn't take down checkout.

## Implementation Decisions

- **Modules**: introduce an **OrderService** (deep) that owns Order persistence and event emission. Wrap the **IdempotencyStore** (deep, Redis-backed) for retry deduplication. Both have small interfaces and significant internal logic; both are unit-testable in isolation.
- **Order lifecycle**: linear `pending → confirmed` or `pending → canceled`, per ADR-0002. No other transitions.
- **Idempotency**: client-supplied `Idempotency-Key` header. Required (story 3). Stored in Redis with 24h TTL, keyed on `(customer_id, key)`. See ADR-0001.
- **Event semantics**: at-least-once delivery, idempotent consumers required. See ADR-0003.
- **Event ordering**: `OrderPlaced` MUST be emitted AFTER the Order row is committed (story 12). On a publish failure, retry with a transactional outbox; never publish before persisting.
- **Authorization**: order history and cancel endpoints check that the requesting Customer owns the Order (story 7). 403 on mismatch.
- **Cancel semantics**: cancel is only valid from `pending`. From `confirmed`, return 409 with an error code that the client UI can translate into "contact support for a refund."

## Testing Decisions

- **Good tests in this codebase** exercise the OrderService through its public interface only — never reach into Redis or the DB directly to assert state. A test should read like a specification: "places an Order with `pending` status and emits OrderPlaced," not "calls `_persist_order` then `_publish_event`."
- **Test these modules**:
  - **OrderService** — placement, cancel transitions, authorization, event emission ordering
  - **IdempotencyStore** — hit/miss semantics, TTL expiration behavior, Redis-outage degradation
  - **HTTP layer** — request validation, status codes, content negotiation, error code shapes
- **Prior art**: existing integration tests in the Catalog context use real Postgres and a real Redis (via testcontainers). Match that pattern — no mocking of internal collaborators.
- **State-machine coverage**: every allowed transition gets a test; every forbidden transition gets a test asserting the 409 response.

## Out of Scope

- Refunds (Billing's concern; see ADR-0002)
- Partial cancellation of individual OrderLines (the Order is the unit of cancellation)
- Order modification after placement (Customers create a new Order if they want different Items)
- Guest checkout (Customer identity is required)
- Multi-currency totals (single-currency for now; ADR for currency boundaries deferred until the requirement is real)
- Inventory checks at order placement (Fulfillment handles backorders; we accept the Order regardless)

## Further Notes

- The Catalog context is the source of truth for Item prices. We snapshot the price into each OrderLine at order time so a future price change doesn't retroactively alter an existing Order.
- Telemetry: every endpoint emits a structured log with `customer_id`, `order_id`, `idempotency_hit` (bool), and latency. The Grafana dashboard for Commerce will need updating to surface the idempotency hit rate as a healthcheck metric.
