import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  createReviewWorkspace,
  defaultReviewWorkspaceRoot,
  safeRemoteUrl,
} from "../skills/review-change/runtime/workspace.mjs";

const exec = promisify(execFile);
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("standalone Review change remote metadata", () => {
  test("retains only credential-safe fetch URLs", () => {
    expect(safeRemoteUrl("https://token:secret@github.com/acme/app.git"))
      .toBe("https://github.com/acme/app.git");
    expect(safeRemoteUrl("git@github.com:acme/app.git")).toBe("git@github.com:acme/app.git");
    expect(safeRemoteUrl("https://github.com/acme/app.git?token=secret")).toBeNull();
    expect(safeRemoteUrl("alice@github.com:acme/app.git")).toBeNull();
    expect(safeRemoteUrl("git@github.com:acme/app.git?token=secret")).toBeNull();
    expect(safeRemoteUrl("git@github.com:acme/app.git#secret")).toBeNull();
    expect(safeRemoteUrl("https://[invalid")).toBeNull();
  });
});

describe("standalone Review change workspace", () => {
  test("keeps review isolation separate from development worktrees", () => {
    expect(defaultReviewWorkspaceRoot("/Users/example")).toBe("/Users/example/.review-treehouse");
  });

  test("snapshots tracked and untracked working state into an isolated clone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-source-"));
    const treehouse = await mkdtemp(path.join(tmpdir(), "review-change-treehouse-"));
    cleanups.push(async () => {
      await Promise.all([rm(root, { recursive: true, force: true }), rm(treehouse, { recursive: true, force: true })]);
    });
    await exec("git", ["init", "-b", "feature/cli", root]);
    await exec("git", ["-C", root, "config", "user.name", "Test User"]);
    await exec("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(root, "tracked.txt"), "before\n");
    await exec("git", ["-C", root, "add", "tracked.txt"]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    await exec("git", ["-C", root, "remote", "add", "origin", "https://token:secret@github.com/acme/app.git"]);
    await writeFile(path.join(root, "tracked.txt"), "after\n");
    await writeFile(path.join(root, "untracked.txt"), "new\n");

    const activity: string[] = [];
    const workspace = await createReviewWorkspace({
      cwd: root,
      reviewRoot: treehouse,
      onActivity: (kind, message) => activity.push(`${kind}:${message}`),
    });
    cleanups.push(workspace.cleanup);

    expect(workspace.cwd).not.toBe(root);
    expect(await readFile(path.join(workspace.cwd, "tracked.txt"), "utf8")).toBe("after\n");
    expect(await readFile(path.join(workspace.cwd, "untracked.txt"), "utf8")).toBe("new\n");
    expect((await exec("git", ["-C", workspace.cwd, "branch", "--show-current"])).stdout.trim())
      .toBe("feature/cli");
    expect((await exec("git", ["-C", workspace.cwd, "config", "--local", "--get", "remote.origin.url"])).stdout.trim())
      .toBe("https://github.com/acme/app.git");
    expect((await exec("git", ["-C", workspace.cwd, "remote", "get-url", "--push", "origin"])).stdout.trim())
      .toBe("no-push://review-change");
    expect(activity.some((entry) => entry.includes("disabled the push URL"))).toBe(true);
    expect(activity.some((entry) => entry.includes("Snapshot ready"))).toBe(true);
    await writeFile(path.join(workspace.cwd, "tracked.txt"), "isolated mutation\n");
    expect(await readFile(path.join(root, "tracked.txt"), "utf8")).toBe("after\n");
  });

  test("rejects a review workspace root inside the reviewed repository before creating it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-source-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.name", "Test User"]);
    await exec("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(root, "README.md"), "source\n");
    await exec("git", ["-C", root, "add", "README.md"]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const reviewRoot = path.join(root, ".review-treehouse");

    await expect(createReviewWorkspace({ cwd: root, reviewRoot })).rejects
      .toThrow("review workspace root must be outside");
    await expect(stat(reviewRoot)).rejects.toThrow();
  });

  test("removes only its recorded workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-source-"));
    const treehouse = await mkdtemp(path.join(tmpdir(), "review-change-treehouse-"));
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.name", "Test User"]);
    await exec("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(root, "README.md"), "source\n");
    await exec("git", ["-C", root, "add", "README.md"]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const workspace = await createReviewWorkspace({ cwd: root, reviewRoot: treehouse });

    await workspace.cleanup();

    await expect(stat(workspace.cwd)).rejects.toThrow();
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("source\n");
    await Promise.all([rm(root, { recursive: true, force: true }), rm(treehouse, { recursive: true, force: true })]);
  });
});
