# Test placement and execution lanes

This repository separates tests by the component they verify and by the resources they consume.
The complete gate uses deterministic lanes so expensive evidence does not accidentally overload an ordinary lane.

## Placement

- Put guard-core unit tests under `shared/` beside the guard implementation.
- Put component tests under the matching `test/<component>/` directory.
- Put cross-component runner, installation, and workflow tests at the `test/` root.
- Keep reusable test support next to the tests that consume it, or at the `test/` root when multiple components consume it.

## Bun test lanes

`scripts/test-suite-classification.mjs` partitions every discovered `*.test.ts` file into exactly one lane.

- `bun/rest` contains ordinary unit and integration tests.
- `bun/browser` contains every file whose name ends with `*.browser.test.ts`.

Any independently discovered suite that launches or requires real Firefox must use the `*.browser.test.ts` suffix.
Keep its focused cases in `*.browser-cases.ts` modules when several case groups can share one Firefox process.
An ordinary `*.test.ts` file must not import the Firefox driver or start Firefox indirectly.
Browser tests must use the shared Firefox fixtures and bounded concurrency rather than creating an unbounded process pool.
Browser case modules must share one of the bounded discovered suites instead of starting a new Firefox process per file.
The pooled browser and ordinary Bun lanes may run together because their combined execution weight stays within the scheduler budget.

The filename is an execution contract, not only a description.
Do not add one-off path exceptions to the test-suite runner.
If a new workload category needs different isolation or scheduling, add one classifier rule and direct contract coverage for the new category.

## Authoring workflow

1. Choose the least expensive evidence that proves the behavior.
2. Put the test in the component directory and apply the browser suffix when real Firefox is required.
3. Run the focused test while developing.
4. Run `make test` before completion.
5. When browser, Git-fixture, or subprocess-heavy work materially changes a lane, measure the lane and update its expected duration and execution weight.

Do not silently skip browser evidence when Firefox is unavailable.
Do not weaken test isolation or concurrency bounds to reduce runtime.
