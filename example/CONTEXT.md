# Commerce — Bounded Context

This context owns customer-facing order placement, order history, and the lifecycle of an Order from creation through fulfillment or cancellation. It does NOT own fulfillment, inventory, or billing — those are separate contexts that consume our domain events.

## Language

**Customer**:
A person or organization that places Orders. Identified by `customer_id`.
_Avoid_: User, Account, Buyer, Client

**Cart**:
A transient collection of Items held by a Customer pre-order. Carts have no persistent identity — they're materialized as part of the order request.
_Avoid_: Basket, Bag

**Item**:
A reference to a sellable product plus a quantity. The Item itself is owned by the Catalog context; we hold only the `item_id` and the quantity at order time.
_Avoid_: Product (Product lives in Catalog), LineItem (we use OrderLine, see below)

**Order**:
A persisted record of a Customer's intent to purchase, with a status, total, and one or more OrderLines. Each Order has a unique `order_id` (ULID).
_Avoid_: Purchase, Transaction, Sale

**OrderLine**:
A single Item-quantity pair within an Order, frozen at the price at order time. Distinct from an Item because an Item is transient (in the Cart) while an OrderLine is persisted to the Order.
_Avoid_: LineItem, OrderItem

**OrderStatus**:
The lifecycle state of an Order. Allowed values: `pending`, `confirmed`, `canceled`. The state machine is intentionally linear (see ADR-0002) — `pending → confirmed` (on Fulfillment acceptance) or `pending → canceled` (on Customer cancel). No back-transitions; no `pending → confirmed → canceled` (that's a Refund, owned by Billing).

**IdempotencyKey**:
A client-provided opaque string (max 64 chars) supplied via the `Idempotency-Key` request header on order placement. Used to deduplicate retries within a 24-hour window (see ADR-0001). Scoped per Customer — two Customers may use the same key without collision.
_Avoid_: RequestId, RetryToken

**OrderPlaced**:
Domain event emitted when an Order is persisted with status `pending`. Consumed by Fulfillment (to start picking) and by Billing (to issue an Invoice). Delivered at-least-once (see ADR-0003).

**OrderCanceled**:
Domain event emitted when an Order transitions from `pending → canceled`. Consumed by Fulfillment (to halt picking if not yet shipped). Delivered at-least-once.

## Relationships

- **Customer → Order**: one-to-many. A Customer owns many Orders.
- **Order → OrderLine**: one-to-many. An Order has at least one OrderLine.
- **OrderLine → Item**: many-to-one. Many OrderLines may reference the same Item across different Orders.
- **Order → IdempotencyKey**: one-to-one when present. An IdempotencyKey deduplicates retries for a single Order.

## Flagged Ambiguities

- **"Cancel"** historically meant either "Customer cancels a pending Order" (what we mean now) or "support refunds a completed Order" (what Billing means). Resolution: Commerce uses `OrderCanceled` for the former; Billing emits `RefundIssued` for the latter. No back-transitions in our state machine.

## Example Dialogue

> **Dev**: "If a Customer hits POST /orders twice in a row with the same Idempotency-Key, do we create two Orders?"
>
> **Domain**: "No. Same key, same Customer, within 24 hours → return the existing Order. Same key from a different Customer → that's a different scope, so a new Order is fine."
>
> **Dev**: "What about after 24 hours? Same key reused?"
>
> **Domain**: "After 24 hours the key has aged out. A new Order is created. We don't error — the key is just no longer matchable."
