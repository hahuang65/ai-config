# Security

- Never hardcode secrets. No API keys, passwords, tokens, or connection strings in source code. Use environment variables or a secrets manager.
- Never commit secrets. If a secret is accidentally staged, remove it from history, rotate the credential, and add the file to `.gitignore`.
- Validate all external input. User input, API request bodies, query parameters, file uploads, and webhook payloads must be validated with schema-based validation before use.
- Parameterize all queries. Never concatenate user input into SQL, ORM queries, or shell commands. Use parameterized queries or prepared statements.
- Escape output. Sanitize user-generated content before rendering in HTML, emails, or logs to prevent XSS and injection.
- No path traversal. Reject or sanitize file paths from user input. Never use user input directly in `fs.readFile`, `open()`, or similar calls.
- Authenticate and authorize every endpoint. New API routes must check authentication and verify the caller has permission for the requested resource.
- No sensitive data in logs. Strip passwords, tokens, PII, and credit card numbers before logging.
