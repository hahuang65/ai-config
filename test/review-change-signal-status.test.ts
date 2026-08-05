import { expect, test } from "bun:test";

import { signalExitCode } from "../skills/review-change/runtime/signal-status.mjs";

test("signal status maps SIGINT and SIGTERM to shell exit codes", () => {
  expect([signalExitCode("SIGINT", 1), signalExitCode("SIGTERM", 1)]).toEqual([130, 143]);
});

test("signal status preserves each caller fallback for an unknown signal", () => {
  expect([signalExitCode("SIGUSR1", 1), signalExitCode("SIGUSR1", 143)]).toEqual([1, 143]);
});
