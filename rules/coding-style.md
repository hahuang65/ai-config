---
description: Project-wide coding conventions. Read before writing or modifying source files — covers immutability, file size limits, function size limits, naming, nesting depth, magic-number avoidance, and where to put error handling.
---

# Coding Style

- Prefer immutability. Return new objects instead of mutating. Use `const`, `final`, `frozen`, or the language equivalent by default.
- Keep files under 400 lines. If a file exceeds this, extract modules.
- Keep functions under 50 lines. If a function exceeds this, split it.
- Max 3 levels of nesting. Flatten with early returns and guard clauses.
- No dead code. Remove unused imports, variables, functions, and commented-out code.
- Name things precisely. A function name should describe what it does. A variable name should describe what it holds. Avoid generic names like `data`, `info`, `item`, `temp`, `result`.
- No magic numbers or strings. Extract constants with descriptive names.
- Prefer explicit over implicit. Avoid clever tricks that sacrifice readability.
- Error handling at boundaries. Validate inputs at system edges (API handlers, CLI parsers, file readers). Trust internal code once validated.
- One abstraction per file. Each file should have a single clear responsibility.

## Coding Guidelines

- Never modify CHANGELOG.md or any other files that are marked as auto-generated or managed by another process.
- Be obsessed with perfection when related to engineering excellence: linting messages, test failures, and test flakiness should be of utmost importance.
- Work on UI should be obsessed with pixel perfection.
- While bug hunting, always begin with reproducing the bug in an E2E setting, as closely aligned with end-user experience as possible. This improves the odds of finding the actual problem, rather than a theoretical issue.
