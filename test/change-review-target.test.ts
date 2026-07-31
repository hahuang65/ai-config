import { afterEach, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { resolveReviewTarget } from "../skills/change-review/runtime/target.mjs";

const exec = promisify(execFile);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFeatureRepository() {
  const root = await mkdtemp(path.join(tmpdir(), "change-review-target-"));
  roots.push(root);
  await exec("git", ["init", "-b", "main", root]);
  await exec("git", ["-C", root, "config", "user.name", "Test User"]);
  await exec("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(root, "file.txt"), "main\n");
  await exec("git", ["-C", root, "add", "file.txt"]);
  await exec("git", ["-C", root, "commit", "-m", "main"]);
  const main = (await exec("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
  await exec("git", ["-C", root, "switch", "-c", "feature/cli"]);
  await writeFile(path.join(root, "file.txt"), "feature\n");
  await exec("git", ["-C", root, "commit", "-am", "feature"]);
  const head = (await exec("git", ["-C", root, "rev-parse", "HEAD"])).stdout.trim();
  await exec("git", ["-C", root, "update-ref", "refs/remotes/origin/main", main]);
  await exec("git", ["-C", root, "update-ref", "refs/remotes/origin/feature/cli", head]);
  await exec("git", ["-C", root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  await exec("git", ["-C", root, "config", "branch.feature/cli.remote", "origin"]);
  await exec("git", ["-C", root, "config", "branch.feature/cli.merge", "refs/heads/feature/cli"]);
  return { root, main, head };
}

describe("standalone Change review target resolution", () => {
  test("uses the default branch when the feature upstream points to itself", async () => {
    const repository = await createFeatureRepository();

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: null,
      findPullRequest: async () => null,
    });

    expect(target).toEqual({ kind: "working-state", target: `${repository.main}...${repository.head}` });
  });

  test("freezes a non-origin explicit range to immutable objects", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/upstream/main", repository.main]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "upstream/main...HEAD",
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
  });

  test("accepts an explicit GitHub pull-request URL", async () => {
    const repository = await createFeatureRepository();
    const pullRequest = "https://github.com/acme/app/pull/42";

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: pullRequest,
    });

    expect(target).toEqual({ kind: "pull-request", target: pullRequest });
  });

  test("freezes a local branch name and reports source-resolution activity", async () => {
    const repository = await createFeatureRepository();
    const activity: string[] = [];

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "feature/cli",
      onActivity: (kind, message) => activity.push(`${kind}:${message}`),
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
    expect(activity.some((entry) => entry.includes("git merge-base"))).toBe(true);
    expect(activity.some((entry) => entry.includes(`Frozen branch feature/cli as ${repository.main}...${repository.head}`))).toBe(true);
  });

  test("freezes a remote branch name from its merge-base with the default branch", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "switch", "main"]);
    await exec("git", ["-C", repository.root, "branch", "-D", "feature/cli"]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "feature/cli",
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
  });

  test("preserves working-state scope when only dirty changes differ from the base", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "reset", "--hard", repository.main]);
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/feature/cli", repository.main]);
    await writeFile(path.join(repository.root, "file.txt"), "dirty\n");

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: null,
      findPullRequest: async () => null,
    });

    expect(target).toEqual({ kind: "working-state", target: `${repository.main}...${repository.main}` });
  });

  test("prefers the current branch pull request for a targetless run", async () => {
    const repository = await createFeatureRepository();
    const pullRequest = "https://github.com/acme/app/pull/42";

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: null,
      findPullRequest: async () => pullRequest,
    });

    expect(target).toEqual({ kind: "pull-request", target: pullRequest });
  });
});
