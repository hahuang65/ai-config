---
description: Block hardcoded secrets, string-concat SQL, user input flowing into file/shell APIs, and eval-on-user-input.
condition:
  - '(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*["''`][A-Za-z0-9+/=_-]{16,}'
  - '(SELECT|INSERT|UPDATE|DELETE)\s+.*\+\s*\w+'
  - '(readFile|readFileSync|open|fs\.read)\s*\([^)]*req\.'
  - '\beval\s*\('
  - 'child_process\.(exec|execSync)\s*\(.*\+'
scope: tool:edit, tool:write, tool:bash
---

# Security

You were about to write something that matches a known security anti-pattern. Stop and re-plan.

Common triggers and the fix:

- **Hardcoded secret literal in source** → Use environment variables or a secrets manager. Never commit API keys, passwords, tokens, or connection strings to the repo. If a secret was accidentally staged, remove it from history, rotate the credential, and add the file to `.gitignore`.
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
