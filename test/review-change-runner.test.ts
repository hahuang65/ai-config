import { expect, test } from "bun:test";

import { runReviewChange } from "../skills/review-change/runtime/runner.mjs";

test("opens the report before finishing status, closing telemetry, and cleaning the exact workspace", async () => {
  const workspacePath = "/isolated/exact-review-workspace";
  const reportPath = "/reports/session/review-change.html";
  const lifecycleEvents: string[] = [];
  const status = {
    start() {},
    begin() {},
    succeed() {},
    fail() {},
    finish(exitCode: number) { lifecycleEvents.push(`status.finish:${exitCode}`); },
    detachTelemetryLog() { lifecycleEvents.push("telemetry.close"); },
  };

  await runReviewChange(
    { target: "main...HEAD", intent: null, piOptions: [] },
    {
      environment: {},
      status,
      resolveTarget: async ({ target }) => ({ kind: "local-range", target }),
      createWorkspace: async () => ({
        cwd: workspacePath,
        sourceRoot: "/repo",
        cleanup: async () => { lifecycleEvents.push(`workspace.cleanup:${workspacePath}`); },
      }),
      createReportDirectory: async () => "/reports/session",
      openReport: async () => {
        lifecycleEvents.push(`report.open:${reportPath}`);
        return reportPath;
      },
      spawnProcess: async () => 0,
    },
  );

  expect(lifecycleEvents).toEqual([
    `report.open:${reportPath}`,
    "status.finish:0",
    "telemetry.close",
    `workspace.cleanup:${workspacePath}`,
  ]);
});
