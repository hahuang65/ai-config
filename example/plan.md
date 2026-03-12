# Plan: API Rate Limiting

## Goal

Add per-client rate limiting to the Acme API using a Redis-backed sliding window log algorithm, with plan-based limits (free/pro/enterprise), per-route overrides, standard response headers, and fail-open behavior on Redis outages.

## Research Reference

`research.md` in this directory.

## Approach

Implement rate limiting as a FastAPI dependency (`check_rate_limit`) that runs after authentication. The dependency resolves the client identifier (API key → user ID → IP), checks a sliding window counter in Redis, and either allows the request (setting rate limit headers) or raises a `RateLimitExceeded` exception that returns a 429 response.

The sliding window log algorithm uses a Redis sorted set per client, where each member is a request timestamp. On each request, expired entries are pruned, the new request is added, and the count is checked — all within a single atomic Redis pipeline.

**Why sliding window log over fixed window?** Fixed windows allow burst traffic at window boundaries (up to 2x the limit). Sliding window log provides smooth, accurate limiting with no boundary spikes. The storage cost (one sorted set member per request) is acceptable for our traffic levels.

**Why a custom implementation over `slowapi`/`limits`?** The existing codebase uses async `redis-py` directly. A custom implementation avoids adding a library dependency, gives full control over the key format and plan-based logic, and integrates cleanly with the existing dependency injection pattern.

## Detailed Changes

### `src/config.py`

Add rate limit configuration to the Pydantic `BaseSettings`:

```python
class Settings(BaseSettings):
    # ... existing fields ...

    # Rate limiting
    rate_limit_default: int = 100  # requests per window (free plan)
    rate_limit_pro: int = 1000
    rate_limit_enterprise: int = 10000
    rate_limit_window_seconds: int = 60
    rate_limit_enabled: bool = True
```

### `src/exceptions/rate_limit.py` (new)

Custom exception for rate limiting:

```python
class RateLimitExceeded(Exception):
    def __init__(self, retry_after: int, limit: int):
        self.retry_after = retry_after
        self.limit = limit
```

### `src/exceptions/handlers.py`

Register the exception handler for `RateLimitExceeded`:

```python
@app.exception_handler(RateLimitExceeded)
async def rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={
            "error": {
                "code": "RATE_LIMITED",
                "message": f"Too many requests. Try again in {exc.retry_after} seconds.",
                "retry_after": exc.retry_after,
            }
        },
        headers={"Retry-After": str(exc.retry_after)},
    )
```

### `src/dependencies/rate_limit.py` (new)

The core rate limiting dependency:

```python
from redis.asyncio import Redis

RATE_LIMITS: dict[str, int] = {
    "free": settings.rate_limit_default,
    "pro": settings.rate_limit_pro,
    "enterprise": settings.rate_limit_enterprise,
}

async def check_rate_limit(
    request: Request,
    response: Response,
    user: User = Depends(get_current_user),
    redis: Redis = Depends(get_redis),
) -> None:
    if not settings.rate_limit_enabled:
        return

    # Resolve client identifier
    key_id = user.api_key_id or user.id or request.client.host
    window = settings.rate_limit_window_seconds
    limit = _get_limit_for_request(request, user)

    redis_key = f"{settings.redis_key_prefix}ratelimit:{key_id}:{window}"
    now = time.time()
    window_start = now - window

    try:
        async with redis.pipeline(transaction=True) as pipe:
            pipe.zremrangebyscore(redis_key, 0, window_start)
            pipe.zadd(redis_key, {str(now): now})
            pipe.zcard(redis_key)
            pipe.pexpire(redis_key, window * 1000)
            results = await pipe.execute()

        count = results[2]
        remaining = max(0, limit - count)
        reset_at = int(now + window)

        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(reset_at)

        if count > limit:
            raise RateLimitExceeded(retry_after=window, limit=limit)
    except (ConnectionError, TimeoutError):
        # Fail open — allow request if Redis is unavailable
        pass
```

### `src/main.py`

Register the rate limit exception handler and add the dependency to the app:

```python
from src.exceptions.rate_limit import RateLimitExceeded
from src.exceptions.handlers import rate_limit_handler

app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
```

Per-route overrides via dependency injection:

```python
def rate_limit(max_requests: int | None = None):
    """Decorator-style dependency for per-route rate limit overrides."""
    async def _check(
        request: Request, response: Response,
        user: User = Depends(get_current_user),
        redis: Redis = Depends(get_redis),
    ) -> None:
        # Same logic as check_rate_limit, but uses max_requests override
        ...
    return Depends(_check)

# Usage:
@router.post("/reports/generate", dependencies=[rate_limit(max_requests=10)])
async def generate_report(...):
    ...
```

## New Files

| File | Purpose |
|------|---------|
| `src/dependencies/rate_limit.py` | Core rate limiting dependency, key resolution, sliding window logic |
| `src/exceptions/rate_limit.py` | `RateLimitExceeded` exception class |
| `tests/dependencies/test_rate_limit.py` | Unit and integration tests for rate limiter |
| `tests/conftest.py` (modify) | Add `fakeredis` fixture |

## Dependencies

No new external dependencies. Uses existing `redis[hiredis]` and `fakeredis[aiocompat]`.

## Considerations & Trade-offs

**Sliding window log vs. token bucket**: Token bucket is more memory-efficient (single counter) but harder to implement correctly with distributed state. Sliding window log uses O(n) storage per client per window but provides exact counts. At our traffic levels (~150 endpoints, ~10k active users), this is well within Redis memory limits.

**Per-route overrides**: Implemented as a dependency factory function rather than middleware, keeping consistent with the existing FastAPI dependency pattern. Routes that need stricter limits (e.g., report generation: 10/min) inject a custom dependency.

**Fail-open vs. fail-closed**: Fail-open was chosen because a Redis outage should not cascade into a full API outage. The risk of excess traffic during Redis downtime is acceptable and can be mitigated at the ALB level.

## Migration / Data Changes

No database migrations. Redis keys are created on-demand and auto-expire via `PEXPIRE`.

## Testing Strategy

### Unit Tests (`tests/dependencies/test_rate_limit.py`)

- **test_allows_request_under_limit**: Send 5 requests with a limit of 100. All should succeed with correct `X-RateLimit-Remaining` headers.
- **test_blocks_request_over_limit**: Send requests exceeding the limit. The last request should receive a 429 response with `Retry-After` header and JSON error body.
- **test_sliding_window_expires_old_entries**: Send requests, wait for the window to pass, then send more. The old requests should not count against the new window.
- **test_plan_based_limits_free**: Authenticate as a free user. Verify the limit is 100/min.
- **test_plan_based_limits_pro**: Authenticate as a pro user. Verify the limit is 1000/min.
- **test_plan_based_limits_enterprise**: Authenticate as an enterprise user. Verify the limit is 10000/min.
- **test_api_key_uses_key_id**: Authenticate with an API key. Verify the rate limit key uses the API key ID, not the user ID.
- **test_ip_fallback_for_unauthenticated**: Send an unauthenticated request. Verify the rate limit key falls back to the client IP.
- **test_fail_open_on_redis_error**: Mock Redis to raise `ConnectionError`. Verify the request is allowed (no 429, no crash).
- **test_per_route_override**: Apply a custom limit of 10 to a route. Verify the 11th request is blocked.
- **test_headers_always_set**: Verify `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers are present on every response, even non-rate-limited ones.
- **test_rate_limit_disabled_via_config**: Set `rate_limit_enabled=False`. Verify no rate limiting is applied and no headers are set.

### Integration Tests

- **test_concurrent_requests_atomic**: Send 50 concurrent requests with a limit of 25. Verify exactly 25 succeed and 25 receive 429 (no race condition allowing >25).

## Todo List

### Phase 1: Core Infrastructure
- [x] Add rate limit settings to `src/config.py` (`rate_limit_default`, `rate_limit_pro`, `rate_limit_enterprise`, `rate_limit_window_seconds`, `rate_limit_enabled`)
- [x] Create `src/exceptions/rate_limit.py` with `RateLimitExceeded` exception
- [x] Register `RateLimitExceeded` handler in `src/exceptions/handlers.py`

### Phase 2: Rate Limiter Implementation
- [x] Create `src/dependencies/rate_limit.py` with sliding window log algorithm
- [x] Implement key resolution (API key → user ID → IP fallback)
- [x] Implement plan-based limit lookup
- [x] Add fail-open error handling for Redis failures
- [x] Set `X-RateLimit-*` response headers

### Phase 3: Integration
- [x] Register rate limit dependency in `src/main.py`
- [x] Add `rate_limit()` factory function for per-route overrides
- [x] Apply stricter limit to `/reports/generate` endpoint

### Phase 4: Testing
- [x] Add `fakeredis` fixture to `tests/conftest.py`
- [x] Write `test_allows_request_under_limit`
- [x] Write `test_blocks_request_over_limit`
- [x] Write `test_sliding_window_expires_old_entries`
- [x] Write `test_plan_based_limits_free`
- [x] Write `test_plan_based_limits_pro`
- [x] Write `test_plan_based_limits_enterprise`
- [x] Write `test_api_key_uses_key_id`
- [x] Write `test_ip_fallback_for_unauthenticated`
- [x] Write `test_fail_open_on_redis_error`
- [x] Write `test_per_route_override`
- [x] Write `test_headers_always_set`
- [x] Write `test_rate_limit_disabled_via_config`
- [x] Write `test_concurrent_requests_atomic`
