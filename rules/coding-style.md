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
