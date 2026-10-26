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

## Smallest complete change

Confirm what the task requires before adding code.
Inspect affected callers, tests, fixtures, configuration, and exports.
Prefer the first suitable option:

1. Existing repository code and conventions.
2. Standard library or native platform features.
3. Dependencies already present in the project.
4. Small new code that fits the existing structure.

Check behavior, errors, ownership, lifecycle, and dependencies before reusing code.
A smaller diff is not complete if requested behavior or integration is missing.
Do not add speculative features, abstractions, configuration, or dependencies.
Preserve validation, error handling, security, and accessibility when moving or simplifying code.
Choose readable, complete solutions rather than minimizing line count.
