---
description: Read before writing or modifying source code.
---

# Coding

Write clean, idiomatic code that humans can maintain.
Follow ecosystem and project conventions.
Write new standalone CLI tools in Rust, not JavaScript, TypeScript, or Python.
Keep host-specific adapters and browser code separate from the Rust CLI implementation.
Keep files under 400 lines and functions under 50 lines.
Use simple control flow and focused modules.
Prefer immutability.
Remove code made unused by the change; do not perform unrelated cleanup.
Change generated code at its source and regenerate it.
Investigate relevant failures and flaky tests.
Reproduce problems with the smallest meaningful case.
