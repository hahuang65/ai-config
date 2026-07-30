---
description: Performance guidance. Read before optimizing code or adding caching, pagination, lazy loading, or external-call timeouts.
---

# Performance

## General performance

- Profile before optimizing. Never guess at bottlenecks.
- Prefer algorithmic improvements over micro-optimizations.
- Cache expensive computations. Invalidate caches explicitly.
- Use pagination for list endpoints. Default to cursor-based for large datasets.
- Lazy-load heavy resources. Load code, images, and data only when needed.
- Set timeouts on all external calls. No unbounded waits for HTTP requests, database queries, or subprocess execution.
