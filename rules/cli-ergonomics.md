---
description: Read before designing, implementing, or reviewing an agent-facing CLI.
---

# CLI

Provide concise help and errors that explain the correction.
Validate all arguments before effects.
Keep machine output stable on stdout and diagnostics on stderr.
Bound output, state truncation explicitly, and provide a way to retrieve the full result.
Distinguish empty results from errors and use meaningful exit codes.
Support noninteractive use without bypassing authentication.
Test through the process boundary.
