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
- `platform/macos-launchd` contains `review-publication-launchd.integration.mjs` and runs only through `make test/macos-launchd` after explicit approval to register a temporary user service.

The macOS launchd lane is separate from `make test` because it mutates the current user's launchd domain.
It fails rather than skips on non-macOS hosts, runs one check with a 35-second watchdog, and uses a unique temporary label, loopback port, home, state directory, and service definition.
Its shell owner unloads the label and removes its temporary artifacts on normal exit, failure, interruption, and timeout.

Any independently discovered suite that launches or requires real Firefox must use the `*.browser.test.ts` suffix.
Keep its focused cases in `*.browser-cases.ts` modules when several case groups can share one Firefox process.
An ordinary `*.test.ts` file must not import the Firefox driver or start Firefox indirectly.
Browser tests must use the shared Firefox fixtures and bounded concurrency rather than creating an unbounded process pool.
Browser case modules must share one of the bounded discovered suites instead of starting a new Firefox process per file.
The browser and ordinary Bun lanes do not run together because Git fixtures, DuckDB subprocesses, and Firefox now exceed the scheduler budget when combined.
The macOS launchd lane never shares either lane and runs one service integration check at a time.

The filename is an execution contract, not only a description.
Do not add one-off path exceptions to the test-suite runner.
If a new workload category needs different isolation or scheduling, add one classifier rule and direct contract coverage for the new category.

## Platform boundaries

Portable tests can render macOS and Linux service definitions or use fake service managers on either host.
They must inject deterministic listener checks and service-manager executables, so the host's active services and installed commands cannot select a test path.
A test that invokes real `launchctl` runs only in the `platform/macos-launchd` lane.
A future test that invokes real `systemctl` must use a separate Linux-only lane and must not run on macOS.
Linux must not run the macOS lane, and macOS must not run a native Linux lane.

## Authoring workflow

1. Choose the least expensive evidence that proves the behavior.
2. Put the test in the component directory and apply the browser suffix when real Firefox is required.
3. Run the focused test while developing.
4. Run `make test` before completion.
5. When browser, Git-fixture, or subprocess-heavy work materially changes a lane, measure the lane and update its expected duration and execution weight.

Do not silently skip browser evidence when Firefox is unavailable.
Do not weaken test isolation or concurrency bounds to reduce runtime.
