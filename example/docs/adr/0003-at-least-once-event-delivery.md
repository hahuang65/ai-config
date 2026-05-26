# OrderPlaced and OrderCanceled are at-least-once

Domain events are delivered at-least-once. Consumers (Fulfillment, Billing) are required to be idempotent on `event_id`.

## Why

Exactly-once delivery across process boundaries is a distributed-systems fairytale. The standard rebuttal applies: the broker can crash after writing the message but before acknowledging the publisher, or the consumer can process a message but crash before acking. In either case the publisher or broker will retry, and a naive consumer will double-process.

We considered:
- **Exactly-once via 2PC** — operationally painful, blocks under partition, makes consumers tightly coupled to our broker's transaction guarantees.
- **At-most-once** — losing an event silently is worse than processing one twice. Fulfillment missing an `OrderPlaced` means a Customer's Order never ships. Unacceptable.
- **At-least-once with idempotent consumers** — chosen. Each event carries a stable `event_id` (ULID). Consumers maintain a "seen" set keyed on `event_id`. Duplicates are dropped at the consumer.

## Consequences

- Every event payload includes `event_id` (ULID), `aggregate_id` (the `order_id`), and `occurred_at` (ISO timestamp).
- Downstream contracts mandate idempotent processing — we publish this expectation in our event schema docs.
- We do NOT order events across aggregates. Within a single Order, events are emitted in the order they occur, but inter-Order ordering is not guaranteed.
