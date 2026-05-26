# IdempotencyKey storage — 24h window in Redis

We deduplicate order-placement retries via a client-supplied `Idempotency-Key` header. Keys are stored in Redis with a 24-hour TTL, mapping `(customer_id, idempotency_key) → order_id`. A retry within the window returns the existing Order; after the window, the key is forgotten and a new Order is created.

## Why this and not the alternatives

- **Redis vs. a Postgres column** — A Redis hit is ~1ms; a Postgres lookup on (customer_id, idempotency_key) under load is 5-20ms with the index, and the table grows unbounded without a cleanup job. Redis's native TTL gives us automatic eviction.
- **24 hours vs. shorter** — Mobile clients with flaky connectivity can take hours to retry. 24h covers realistic retry windows without holding state indefinitely.
- **24 hours vs. longer** — Beyond 24h, a stale key reuse is more likely an unrelated request than a retry. We'd rather create a duplicate Order than block a legitimate new one.

## Consequences

- A Redis outage degrades the idempotency guarantee. We accept this: the worst case is a duplicate Order, not data loss. We will NOT fall back to Postgres on Redis failure — that would mask the outage and cause inconsistent latency.
- The key is scoped per `(customer_id, key)` — two Customers may legitimately use the same opaque string without collision.
