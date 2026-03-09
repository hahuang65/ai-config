---
name: api-design
description: REST API design patterns including resource naming, status codes, pagination, filtering, error responses, versioning, and rate limiting. Reference skill loaded by the plan phase when API work is detected.
argument-hint: [topic-or-question]
---

# API Design Patterns

Reference patterns for designing consistent REST APIs.

## Resource URL Structure

- Resources are nouns, plural, lowercase, kebab-case
- `GET /api/v1/users`, `POST /api/v1/users`, `GET /api/v1/users/:id`
- Sub-resources for relationships: `GET /api/v1/users/:id/orders`
- Actions that don't map to CRUD: `POST /api/v1/orders/:id/cancel`

## HTTP Status Codes

| Code | When |
|------|------|
| 200 | GET, PUT, PATCH with response body |
| 201 | POST (include Location header) |
| 204 | DELETE, PUT with no body |
| 400 | Validation failure, malformed input |
| 401 | Missing or invalid authentication |
| 403 | Authenticated but not authorized |
| 404 | Resource doesn't exist |
| 409 | Duplicate entry, state conflict |
| 422 | Valid JSON but semantically invalid |
| 429 | Rate limit exceeded |

## Pagination

### Offset-Based (simple, for small datasets <10K)
`GET /api/v1/users?page=2&per_page=20`

### Cursor-Based (scalable, for large datasets or infinite scroll)
`GET /api/v1/users?cursor=eyJpZCI6MTIzfQ&limit=20`

Response includes `meta.has_next` and `meta.next_cursor`.

## Error Response Format

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": [
      { "field": "email", "message": "Must be a valid email", "code": "invalid_format" }
    ]
  }
}
```

## Filtering and Sorting

- Equality: `?status=active&customer_id=abc`
- Comparison: `?price[gte]=10&price[lte]=100`
- Multiple values: `?category=electronics,clothing`
- Sorting: `?sort=-created_at,price` (prefix `-` for descending)
- Sparse fieldsets: `?fields=id,name,email`

## Rate Limiting Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640000000
```

## Versioning

Use URL path versioning: `/api/v1/users`. Maintain at most 2 active versions. Non-breaking changes (adding fields, adding endpoints) don't need a new version.

## Input Validation

Always validate at the boundary with schema-based validation (Zod, Pydantic, etc.). Return 422 with field-level error details.
