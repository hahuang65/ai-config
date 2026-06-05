---
description: Read before writing code that builds SQL, calls eval, shells out, or feeds user input into file APIs — security anti-patterns plus the always-on input/output/authz/logging rules.
---

# Security

Watch for these anti-patterns when writing or editing code, and re-plan with the safe alternative. (Hardcoded secret literals are blocked outright by the guard core — see `no-hardcoded-secret`; this rule covers the fuzzier patterns that are guidance, not hard blocks.)

Common triggers and the fix:

- **String-concatenated SQL** → Use parameterized queries or prepared statements. Never concatenate user input into SQL, ORM queries, or shell commands.
- **User input passed directly to a file API** → Sanitize or reject paths from user input. Never feed `req.body`, `req.params`, or `req.query` into `fs.readFile`, `open()`, or similar without validation.
- **`eval()` on dynamic input** → Use a proper parser, lookup table, or AST. `eval` on anything touched by user input is a code-injection vector.
- **`child_process.exec` with string concatenation** → Use `execFile` or `spawn` with an args array. String concat into a shell is a command-injection vector.

Plus the always-on security rules this file enforces:

- Validate all external input with schema-based validation (user input, API request bodies, query parameters, file uploads, webhook payloads).
- Escape output before rendering in HTML, emails, or logs to prevent XSS.
- Authenticate and authorize every new API route — check auth, verify the caller has permission for the requested resource.
- Strip passwords, tokens, PII, and credit card numbers before logging.

Re-plan the edit with one of these patterns, then proceed.
