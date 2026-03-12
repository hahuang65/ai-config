# Research: API Rate Limiting

## Overview

The Acme API is a Python/FastAPI application serving a SaaS platform with ~150 endpoints across 10 resource domains (users, teams, billing, projects, etc.). Currently, there is **no rate limiting** — any client can make unlimited requests. The API serves both first-party web/mobile clients and third-party integrations via API keys.

The API runs behind an AWS ALB load balancer with 4 uvicorn workers in production. Redis (ElastiCache) is already used for session storage and caching.

## Architecture

The request pipeline follows a standard FastAPI middleware/dependency chain:

```
Client Request
  → ALB (TLS termination, health checks)
    → FastAPI App
      → CORSMiddleware
      → TrustedHostMiddleware
      → get_current_user() dependency — extracts JWT or API key, returns User
      → route handler — business logic
      → exception_handler — catches exceptions, returns JSON
```

Authentication is handled by the `get_current_user` dependency in `src/dependencies/auth.py`, which returns a `User` model with:
- `id: str` — user UUID
- `team_id: str` — team UUID
- `plan: Literal["free", "pro", "enterprise"]` — subscription tier
- `api_key_id: str | None` — populated when using API key auth

There is no middleware or dependency between auth and route handlers where rate limiting would naturally fit.

## Key Files

| File | Role |
|------|------|
| `src/main.py` | FastAPI app setup, middleware registration, router mounting |
| `src/dependencies/auth.py` | JWT/API key authentication, returns `User` model |
| `src/exceptions/handlers.py` | Global exception handlers, JSON error formatting |
| `src/services/redis.py` | Redis client singleton (redis-py async), connection pool |
| `src/config.py` | Pydantic `BaseSettings` config, environment loading |
| `src/models/user.py` | User Pydantic model, plan enum |
| `src/routers/__init__.py` | Router aggregator, mounts all resource routers |

## Data Flow

### Current Request Flow (No Rate Limiting)

1. Request arrives at ALB → forwarded to uvicorn worker
2. `get_current_user` dependency extracts credentials, validates, returns `User`
3. Route handler executes business logic
4. Response sent (or exception caught by `exception_handler`)

### Proposed Rate Limiting Flow

1. Request arrives at ALB → forwarded to uvicorn worker
2. `get_current_user` dependency extracts credentials, validates, returns `User`
3. **`check_rate_limit` dependency checks rate limit** ← NEW
   - Builds a key from the client identifier (user ID, API key, or IP)
   - Increments counter in Redis using sliding window log
   - If under limit: sets `X-RateLimit-*` headers via `Response`, continues
   - If over limit: raises `RateLimitExceeded` with `Retry-After`
4. Route handler executes business logic
5. Response sent (or exception caught by `exception_handler`)

## Patterns & Conventions

### Dependency Pattern
All dependencies follow the FastAPI `Depends()` pattern:

```python
# src/dependencies/auth.py (representative pattern)
async def get_current_user(
    request: Request,
    redis: Redis = Depends(get_redis),
) -> User:
    token = request.headers.get("Authorization", "").removeprefix("Bearer ")
    if not token:
        raise HTTPException(status_code=401, detail="Missing credentials")
    # ... validate and return User
```

Dependencies are injected in route handlers via `Depends()` or applied at the router level via `dependencies=[Depends(fn)]`.

### Configuration Pattern
Config uses Pydantic `BaseSettings` with environment variables:

```python
# src/config.py
class Settings(BaseSettings):
    redis_url: str = "redis://localhost:6379"
    redis_key_prefix: str = "acme:"

    model_config = SettingsConfigDict(env_file=".env")

settings = Settings()
```

### Error Response Pattern
All errors are returned as JSON via exception handlers:

```json
{
  "error": {
    "code": "RATE_LIMITED",
    "message": "Too many requests. Please try again in 45 seconds.",
    "retry_after": 45
  }
}
```

### Redis Key Pattern
Existing keys use the prefix pattern: `acme:{domain}:{identifier}`. Examples:
- `acme:session:{session_id}`
- `acme:cache:user:{user_id}`

Rate limit keys should follow: `acme:ratelimit:{identifier}:{window}`.

### Testing Pattern
Tests use pytest with httpx `AsyncClient` for integration tests. Each module has a test file:

```
tests/dependencies/test_auth.py
tests/exceptions/test_handlers.py
```

Redis-dependent tests use `fakeredis[aiocompat]` for unit tests and a real Redis instance (via Docker) for integration tests.

## Dependencies

### Internal
- `src/services/redis.py` — async Redis client (redis-py v5.0)
- `src/config.py` — Pydantic settings loader
- `src/models/user.py` — User model with plan field

### External (already installed)
- `redis[hiredis]` v5.0.4 — async Redis client
- `fastapi` v0.111.0 — web framework
- `pytest` v8.2.0 — test framework
- `httpx` v0.27.0 — async HTTP client for testing
- `fakeredis[aiocompat]` v2.23.0 — Redis mock for tests

### External (new)
- None needed. The sliding window algorithm can be implemented with existing `redis-py` commands (pipeline with ZADD/ZRANGEBYSCORE/ZREMRANGEBYSCORE/ZCARD).

## Edge Cases & Gotchas

1. **Multi-worker deployment**: Rate limiting MUST use Redis, not in-memory storage. The 4 uvicorn workers share nothing — an in-memory counter would allow 4x the intended limit.

2. **Clock skew**: Sliding window uses Redis server time via `TIME` command, not application time, to avoid clock skew between workers.

3. **Key identifier priority**: For rate limiting keys, the priority should be:
   - API key ID (if present) — third-party integrations get their own limit
   - User ID (if authenticated) — logged-in users get per-user limits
   - IP address (fallback) — unauthenticated requests limited by IP

4. **Plan-based limits**: Different subscription plans should have different rate limits (e.g., free: 100 req/min, pro: 1000 req/min, enterprise: 10000 req/min). This requires reading `user.plan` after auth.

5. **Redis failure mode**: If Redis is unavailable, the rate limiter should **fail open** (allow requests) rather than fail closed (block all requests). A Redis outage should degrade gracefully, not cause a full API outage.

6. **Heavyweight endpoints**: Some endpoints (report generation, bulk exports) should have separate, stricter rate limits. The dependency should support per-route override configuration.

7. **Response headers**: Standard rate limit headers should always be set (even on non-limited responses):
   - `X-RateLimit-Limit` — max requests in window
   - `X-RateLimit-Remaining` — requests left in current window
   - `X-RateLimit-Reset` — Unix timestamp when window resets

8. **Race conditions**: The increment-and-check must be atomic. Using a Redis pipeline or Lua script ensures concurrent requests from the same client don't exceed the limit due to read-then-write races.

## Current State

- **No rate limiting exists** — this is a greenfield addition
- Redis infrastructure is production-ready (ElastiCache with failover)
- The dependency chain has a clear insertion point (after auth, before route handlers)
- The codebase has good test coverage patterns to follow
- The exception handler already supports custom error codes and HTTP status codes
- No existing rate limiting library is installed; a custom implementation using the sliding window log algorithm is preferred for control and simplicity
