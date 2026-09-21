import { afterEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import {
  CLI,
  cleanupTemporaryDirectories,
  repository,
  runWorkLog,
  temporaryDirectory,
} from "./support.ts";

afterEach(cleanupTemporaryDirectories);

describe("work-log CLI contract", () => {
  test("returns a definitive empty Open work envelope", () => {
    const invocation = spawnSync("node", [CLI, "open", "--json"], {
      cwd: repository(),
      encoding: "utf8",
      env: { ...process.env, WORK_LOG_DIR: temporaryDirectory("work-log-store-") },
    });

    expect(JSON.parse(invocation.stdout)).toEqual({
      items: [],
      returned_count: 0,
      total_count: 0,
      truncated: false,
    });
  });

  test("returns bounded Open work with total and truncation metadata", () => {
    const cwd = repository();
    const store = temporaryDirectory("work-log-store-");
    runWorkLog(cwd, store, { action: "plan", title: "One", summary: "First work item." });
    runWorkLog(cwd, store, { action: "plan", title: "Two", summary: "Second work item." });

    const invocation = spawnSync("node", [CLI, "open", "--json", "--limit", "1"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, WORK_LOG_DIR: store },
    });

    expect(invocation.status).toBe(0);
    const response = JSON.parse(invocation.stdout);
    expect(response).toMatchObject({ returned_count: 1, total_count: 2, truncated: true });
    expect(response.items).toHaveLength(1);
  });

  test("rejects unknown checkpoint fields", () => {
    const invocation = runWorkLog(repository(), temporaryDirectory("work-log-store-"), {
      action: "plan",
      title: "Invalid input",
      summary: "This contains an invented field.",
      priority: "high",
    });

    expect(invocation.status).toBe(1);
    expect(invocation.stderr).toContain("Unsupported checkpoint field: priority");
  });

  test("rejects unknown options with a usage exit status", () => {
    const invocation = spawnSync("node", [CLI, "open", "--bogus"], {
      cwd: repository(),
      encoding: "utf8",
      env: { ...process.env, WORK_LOG_DIR: temporaryDirectory("work-log-store-") },
    });

    expect(invocation.status).toBe(2);
    expect(invocation.stderr).toContain("Unknown option for open: --bogus");
  });
});
