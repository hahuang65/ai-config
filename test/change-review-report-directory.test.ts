import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createReportDirectory } from "../skills/change-review/runtime/report-directory.mjs";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Change review report directory", () => {
  test("rejects a preferred temp root inside the source checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "change-review-report-test-"));
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const workspaceRoot = path.join(root, "workspace");
    const fallbackRoot = path.join(root, "safe-temp");
    await Promise.all([mkdir(sourceRoot), mkdir(workspaceRoot)]);

    const reportRoot = await createReportDirectory({
      sourceRoot,
      workspaceRoot,
      preferredRoot: sourceRoot,
      fallbackRoot,
    });

    expect(path.relative(sourceRoot, reportRoot).startsWith("..")).toBe(true);
    expect(reportRoot.startsWith(await realpath(fallbackRoot))).toBe(true);
  });

  test("rejects a symlinked temp root that resolves into the source checkout", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "change-review-report-test-"));
    roots.push(root);
    const sourceRoot = path.join(root, "source");
    const workspaceRoot = path.join(root, "workspace");
    const fallbackRoot = path.join(root, "safe-temp");
    const linkedAncestor = path.join(root, "linked-temp");
    const preferredRoot = path.join(linkedAncestor, "new-child");
    await Promise.all([mkdir(sourceRoot), mkdir(workspaceRoot)]);
    await symlink(sourceRoot, linkedAncestor);

    const reportRoot = await createReportDirectory({
      sourceRoot,
      workspaceRoot,
      preferredRoot,
      fallbackRoot,
    });

    expect(reportRoot.startsWith(await realpath(fallbackRoot))).toBe(true);
    await expect(stat(path.join(sourceRoot, "new-child"))).rejects.toThrow();
  });
});
