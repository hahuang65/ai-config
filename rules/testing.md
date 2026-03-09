# Testing

- TDD is the default. Write a failing test before writing implementation code. Red → Green → Refactor.
- Every behavioral change must have test coverage. No exceptions.
- Maximize shared setup. Use `before`/`let`/`subject`/`factory` blocks so common state is defined once. Each test should apply the bare minimum mutation for its scenario and assert.
- Test behavior, not implementation. Tests should verify what the code does, not how it does it. Avoid testing private methods or internal state.
- One assertion per test when possible. If a test needs multiple assertions, they should all verify the same behavior.
- Name tests as sentences that describe the expected behavior: "returns empty list when no results match", not "test_query_3".
- Keep test files next to the code they test, or in a parallel `test/` directory matching the source structure.
- No test interdependence. Each test must pass in isolation and in any order.
