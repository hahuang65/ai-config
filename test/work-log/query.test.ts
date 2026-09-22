import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  CLI,
  cleanupTemporaryDirectories,
  repository,
  runWorkLog,
  temporaryDirectory,
} from "./support.ts";

const HOUR_MILLISECONDS = 60 * 60 * 1_000;

afterEach(cleanupTemporaryDirectories);

describe("work-log queries", () => {
  test("lists Open work without completed work items", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const planned = runWorkLog(cwd, store, {
      action: "plan", title: "Planned work", summary: "Keep this open.",
    });
    const active = runWorkLog(cwd, store, {
      action: "start", title: "Active work", summary: "Start this now.",
    });
    runWorkLog(cwd, store, {
      action: "complete",
      work_item_id: JSON.parse(active.stdout).work_item_id,
      summary: "Finish the active work.",
    }, "2026-09-18T11:00:00.000Z");

    const invocation = query(cwd, store, "open", "--json");

    expect(invocation.status).toBe(0);
    const openWork = JSON.parse(invocation.stdout).items;
    expect(openWork.map((work: { title: string }) => work.title)).toEqual(["Planned work"]);
    expect(openWork[0].work_item_id).toBe(JSON.parse(planned.stdout).work_item_id);
  });

  test("renders a period summary grouped by repository with Open work", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const completed = runWorkLog(cwd, store, {
      action: "start", title: "Completed work", summary: "Begin the completed item.",
    });
    runWorkLog(cwd, store, {
      action: "complete",
      work_item_id: JSON.parse(completed.stdout).work_item_id,
      summary: "Finished and verified the item.",
      commits: ["abc123"],
    }, "2026-09-18T11:00:00.000Z");
    runWorkLog(cwd, store, {
      action: "plan", title: "Future work", summary: "Retain this for later.",
    }, "2026-09-18T12:00:00.000Z");

    const invocation = query(
      cwd,
      store,
      "summary",
      "--from",
      "2026-09-18",
      "--to",
      "2026-09-18",
    );

    expect(invocation.stdout).toContain("### github.com/Example/Project");
    expect(invocation.stdout).toContain("- Completed work — Finished and verified the item.");
    expect(invocation.stdout).toContain("### Open work");
    expect(invocation.stdout).toContain("- Future work [planned]");
  });

  test("returns the complete effective checkpoint history", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const planned = runWorkLog(cwd, store, {
      action: "plan", title: "Historical work", summary: "Plan the work.",
    });
    const workItemId = JSON.parse(planned.stdout).work_item_id;
    runWorkLog(cwd, store, {
      action: "start", work_item_id: workItemId, summary: "Start the work.",
    }, "2026-09-18T11:00:00.000Z");

    const invocation = query(cwd, store, "history", workItemId, "--json");

    const history = JSON.parse(invocation.stdout).items;
    expect(history.map((checkpoint: { state: string }) => checkpoint.state)).toEqual([
      "planned",
      "active",
    ]);
  });

  test("returns a chronological timeline for a date range", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    runWorkLog(cwd, store, {
      action: "plan", title: "Earlier work", summary: "Record the earlier checkpoint.",
    }, "2026-09-17T23:00:00.000Z");
    runWorkLog(cwd, store, {
      action: "plan", title: "Later work", summary: "Record the later checkpoint.",
    }, "2026-09-18T09:00:00.000Z");

    const invocation = query(
      cwd,
      store,
      "timeline",
      "--from",
      "2026-09-17",
      "--to",
      "2026-09-18",
      "--json",
    );

    const timeline = JSON.parse(invocation.stdout).items;
    expect(timeline.map((checkpoint: { title: string }) => checkpoint.title)).toEqual([
      "Earlier work",
      "Later work",
    ]);
  });

  test("uses the corrected checkpoint in derived views", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const planned = runWorkLog(cwd, store, {
      action: "plan", title: "Typoed titel", summary: "Wrong summary.",
    });
    const output = JSON.parse(planned.stdout);
    spawnSync("node", [CLI, "correct", output.checkpoint_id], {
      cwd,
      encoding: "utf8",
      input: JSON.stringify({ title: "Correct title", summary: "Correct summary." }),
      env: { ...process.env, WORK_LOG_DIR: store, PI_SESSION_ID: "pi-session-1" },
    });

    const open = query(cwd, store, "open", "--json");

    expect(JSON.parse(open.stdout).items[0].title).toBe("Correct title");
  });

  test("derives continuing active and elapsed time for active work", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const startedAt = new Date(Date.now() - (2 * HOUR_MILLISECONDS)).toISOString();
    const started = runWorkLog(cwd, store, {
      action: "start", title: "Active timed work", summary: "Keep this work active.",
    }, startedAt);
    const workItemId = JSON.parse(started.stdout).work_item_id;

    const timedQuery = queryTimedWorkItem(cwd, store, workItemId);

    expectDurationWithinQueryWindow(timedQuery.workItem.active_seconds, startedAt, timedQuery);
    expectDurationWithinQueryWindow(timedQuery.workItem.elapsed_seconds, startedAt, timedQuery);
  });

  test("stops active time while paused but continues elapsed time", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const now = Date.now();
    const startedAt = new Date(now - (3 * HOUR_MILLISECONDS)).toISOString();
    const started = runWorkLog(cwd, store, {
      action: "start", title: "Paused timed work", summary: "Start before pausing.",
    }, startedAt);
    const workItemId = JSON.parse(started.stdout).work_item_id;
    transition(cwd, store, workItemId, "pause", new Date(now - (2 * HOUR_MILLISECONDS)).toISOString());

    const timedQuery = queryTimedWorkItem(cwd, store, workItemId);

    expect(timedQuery.workItem.active_seconds).toBe(3600);
    expectDurationWithinQueryWindow(timedQuery.workItem.elapsed_seconds, startedAt, timedQuery);
  });

  test("freezes active and elapsed time when work completes", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const started = runWorkLog(cwd, store, {
      action: "start", title: "Completed timed work", summary: "Start the first interval.",
    }, "2026-09-18T10:00:00.000Z");
    const workItemId = JSON.parse(started.stdout).work_item_id;
    transition(cwd, store, workItemId, "pause", "2026-09-18T11:00:00.000Z");
    transition(cwd, store, workItemId, "start", "2026-09-18T12:00:00.000Z");
    transition(cwd, store, workItemId, "complete", "2026-09-18T13:00:00.000Z");

    const workItem = JSON.parse(query(cwd, store, "item", workItemId, "--json").stdout);

    expect({
      active_seconds: workItem.active_seconds,
      elapsed_seconds: workItem.elapsed_seconds,
    }).toEqual({ active_seconds: 7200, elapsed_seconds: 10800 });
  });

  test("freezes absolute active and elapsed time across offset changes when work is abandoned", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const started = runWorkLog(cwd, store, {
      action: "start", title: "Abandoned timed work", summary: "Start before abandoning.",
    }, "2026-03-08T01:30:00.000-08:00");
    const workItemId = JSON.parse(started.stdout).work_item_id;
    transition(cwd, store, workItemId, "abandon", "2026-03-08T03:30:00.000-07:00");

    const workItem = JSON.parse(query(cwd, store, "item", workItemId, "--json").stdout);

    expect({
      active_seconds: workItem.active_seconds,
      elapsed_seconds: workItem.elapsed_seconds,
    }).toEqual({ active_seconds: 3600, elapsed_seconds: 3600 });
  });

  test("renders a compact repository-scoped session digest", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    runWorkLog(cwd, store, {
      action: "start", title: "Active work", summary: "Continue this work.",
    });
    runWorkLog(cwd, store, {
      action: "plan",
      title: "Due work",
      summary: "Do this by the due date.",
      due_at: "2026-09-18T12:00:00.000Z",
    });
    runWorkLog(cwd, store, {
      action: "plan", title: "Undated work", summary: "Keep this in Open work.",
    });

    const invocation = query(cwd, store, "digest", {
      WORK_LOG_NOW: "2026-09-19T00:00:00.000Z",
    });

    expect(invocation.stdout).toContain("Active: Active work");
    expect(invocation.stdout).toContain("Due or overdue: Due work");
    expect(invocation.stdout).toContain("Other planned work: 1");
    expect(invocation.stdout).not.toContain("Undated work");
  });
});

function query(cwd: string, store: string, ...argumentsOrEnvironment: any[]) {
  const maybeEnvironment = argumentsOrEnvironment.at(-1);
  const extraEnvironment = maybeEnvironment && typeof maybeEnvironment === "object"
    ? argumentsOrEnvironment.pop()
    : {};
  return spawnSync("node", [CLI, ...argumentsOrEnvironment], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, WORK_LOG_DIR: store, TZ: "UTC", ...extraEnvironment },
  });
}

function queryTimedWorkItem(cwd: string, store: string, workItemId: string) {
  const queryStartedAt = Date.now();
  const invocation = query(cwd, store, "item", workItemId, "--json");
  const queryFinishedAt = Date.now();
  return {
    workItem: JSON.parse(invocation.stdout),
    queryStartedAt,
    queryFinishedAt,
  };
}

function expectDurationWithinQueryWindow(
  actualSeconds: number,
  checkpointAt: string,
  queryWindow: { queryStartedAt: number; queryFinishedAt: number },
) {
  const checkpointMilliseconds = new Date(checkpointAt).valueOf();
  const minimumSeconds = Math.round((queryWindow.queryStartedAt - checkpointMilliseconds) / 1_000);
  const maximumSeconds = Math.round((queryWindow.queryFinishedAt - checkpointMilliseconds) / 1_000);
  expect(actualSeconds).toBeGreaterThanOrEqual(minimumSeconds);
  expect(actualSeconds).toBeLessThanOrEqual(maximumSeconds);
}

function transition(cwd: string, store: string, workItemId: string, action: string, now: string) {
  runWorkLog(cwd, store, {
    action,
    work_item_id: workItemId,
    summary: `${action} timed work.`,
  }, now);
}
