import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

import {
  CLI,
  cleanupTemporaryDirectories,
  git,
  repository,
  runWorkLog,
  temporaryDirectory,
} from "./support.ts";

afterEach(cleanupTemporaryDirectories);

describe("work-log writes", () => {
  test("creates a planned work item in the current Git repository", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const invocation = runWorkLog(cwd, store, {
      action: "plan",
      title: "Add work logging",
      summary: "Retain this work for a later session.",
      tickets: ["ABC-123"],
    });

    expect(invocation.status).toBe(0);
    const output = JSON.parse(invocation.stdout);
    const checkpoint = JSON.parse(readFileSync(output.path, "utf8"));
    expect(checkpoint).toMatchObject({
      schema_version: 1,
      checkpoint_id: output.checkpoint_id,
      work_item_id: output.work_item_id,
      occurred_at: "2026-09-18T10:30:00.000Z",
      event_type: "lifecycle",
      state: "planned",
      title: "Add work logging",
      repository_id: "github.com/Example/Project",
      branch: "main",
      harness: "pi",
      session_id: "pi-session-1",
      tickets: ["ABC-123"],
    });
  });

  test("rejects capture outside a Git repository", () => {
    const invocation = runWorkLog(
      temporaryDirectory("work-log-no-repository-"),
      temporaryDirectory("work-log-store-"),
      { action: "plan", title: "Unscoped work", summary: "Do not record this." },
    );

    expect(invocation.status).toBe(1);
    expect(invocation.stderr).toContain("requires a Git repository");
  });

  test("retains a local repository identity after an origin is added", () => {
    const cwd = temporaryDirectory("work-log-local-repository-");
    const store = temporaryDirectory("work-log-store-");
    git(cwd, "init", "--initial-branch=main");
    const first = runWorkLog(cwd, store, {
      action: "plan",
      title: "Local work",
      summary: "Start before publishing the repository.",
    });
    const firstCheckpoint = JSON.parse(readFileSync(JSON.parse(first.stdout).path, "utf8"));

    git(cwd, "remote", "add", "origin", "https://github.com/example/local-work.git");
    const second = runWorkLog(cwd, store, {
      action: "checkpoint",
      work_item_id: firstCheckpoint.work_item_id,
      summary: "Published the repository.",
    });

    const secondCheckpoint = JSON.parse(readFileSync(JSON.parse(second.stdout).path, "utf8"));
    expect(secondCheckpoint.repository_id).toBe(firstCheckpoint.repository_id);
    expect(secondCheckpoint.repository_origin).toBe("github.com/example/local-work");
  });

  test("rejects a relationship to a missing work item", () => {
    const repo = repository();
    const store = temporaryDirectory("work-log-store-");

    const invocation = runWorkLog(repo, store, {
      action: "plan",
      title: "Orphaned child",
      summary: "Do not retain a broken relationship.",
      parent_work_item_id: "work_00000000-0000-4000-8000-000000000000",
    });

    expect(invocation.status).toBe(1);
    expect(invocation.stderr).toContain("Related work item not found");
  });

  test("records a state transition for an existing work item", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const planned = runWorkLog(cwd, store, {
      action: "plan", title: "Add work logging", summary: "Retain this work.",
    });
    const workItemId = JSON.parse(planned.stdout).work_item_id;

    const started = runWorkLog(cwd, store, {
      action: "start", work_item_id: workItemId, summary: "Implementation started.",
    });

    const checkpoint = JSON.parse(readFileSync(JSON.parse(started.stdout).path, "utf8"));
    expect(checkpoint).toMatchObject({
      work_item_id: workItemId,
      event_type: "lifecycle",
      state: "active",
    });
  });

  test("rejects an invalid lifecycle transition", () => {
    const repo = repository();
    const store = temporaryDirectory("work-log-store-");
    const started = runWorkLog(repo, store, {
      action: "start", title: "Active work", summary: "Begin in the active state.",
    });

    const invocation = runWorkLog(repo, store, {
      action: "start",
      work_item_id: JSON.parse(started.stdout).work_item_id,
      summary: "Attempt to start work that is already active.",
    });

    expect(invocation.status).toBe(1);
    expect(invocation.stderr).toContain("cannot follow state active");
  });

  test("replaces an ordinary mistake with an append-only correction", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const planned = runWorkLog(cwd, store, {
      action: "plan", title: "Typoed titel", summary: "The summary is wrong.",
    });
    const plannedOutput = JSON.parse(planned.stdout);

    const corrected = spawnSync("node", [CLI, "correct", plannedOutput.checkpoint_id], {
      cwd,
      encoding: "utf8",
      input: JSON.stringify({ title: "Correct title", summary: "The corrected summary." }),
      env: {
        ...process.env,
        WORK_LOG_DIR: store,
        WORK_LOG_NOW: "2026-09-18T11:00:00.000Z",
        PI_SESSION_ID: "pi-session-1",
      },
    });

    expect(corrected.status).toBe(0);
    const correction = JSON.parse(readFileSync(JSON.parse(corrected.stdout).path, "utf8"));
    expect(correction).toMatchObject({
      event_type: "correction",
      corrects_checkpoint_id: plannedOutput.checkpoint_id,
      work_item_id: plannedOutput.work_item_id,
      title: "Correct title",
    });
  });

  test("physically purges a checkpoint after sensitive-data confirmation", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const planned = runWorkLog(cwd, store, {
      action: "plan", title: "Purge this checkpoint", summary: "Later identified as sensitive.",
    });
    const output = JSON.parse(planned.stdout);

    const invocation = spawnSync(
      "node",
      [CLI, "purge", output.checkpoint_id, "--confirm-sensitive-purge"],
      { cwd, encoding: "utf8", env: { ...process.env, WORK_LOG_DIR: store } },
    );

    expect(invocation.status).toBe(0);
    expect(() => readFileSync(output.path, "utf8")).toThrow();
  });

  test("keeps a work item associated with its repository", () => {
    const owningRepository = repository();
    const otherRepository = temporaryDirectory("work-log-other-repository-");
    git(otherRepository, "init", "--initial-branch=main");
    git(otherRepository, "remote", "add", "origin", "git@github.com:Example/Other.git");
    const store = temporaryDirectory("work-log-store-");
    const planned = runWorkLog(owningRepository, store, {
      action: "plan", title: "Owned work", summary: "Keep this with its repository.",
    });

    const invocation = runWorkLog(otherRepository, store, {
      action: "start",
      work_item_id: JSON.parse(planned.stdout).work_item_id,
      summary: "Attempt to move the work item.",
    });

    expect(invocation.status).toBe(1);
    expect(invocation.stderr).toContain("belongs to repository");
  });

  test("rejects reopening a terminal work item", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    const started = runWorkLog(cwd, store, {
      action: "start", title: "Terminal work", summary: "Start the work.",
    });
    const workItemId = JSON.parse(started.stdout).work_item_id;
    runWorkLog(cwd, store, {
      action: "complete", work_item_id: workItemId, summary: "Complete the work.",
    }, "2026-09-18T11:00:00.000Z");

    const invocation = runWorkLog(cwd, store, {
      action: "start", work_item_id: workItemId, summary: "Attempt to reopen it.",
    }, "2026-09-18T12:00:00.000Z");

    expect(invocation.status).toBe(1);
    expect(invocation.stderr).toContain("terminal");
  });

  test("rejects checkpoint text that appears to contain a secret", () => {
    const invocation = runWorkLog(repository(), temporaryDirectory("work-log-store-"), {
      action: "plan", title: "Unsafe work", summary: "token=do-not-store-this",
    });

    expect(invocation.status).toBe(1);
    expect(invocation.stderr).toContain("appears to contain a secret");
  });
});
