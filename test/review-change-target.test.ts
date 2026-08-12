import { afterAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  resolveAcquiredGitHubTarget,
  resolveReviewTarget,
} from "../skills/review-change/runtime/target.mjs";
import { createConcurrencyLimit } from "./concurrency-limit";
import { ISOLATED_GIT_ENV, isolateTestGitConfiguration } from "./git-environment";

isolateTestGitConfiguration();
const executeFile = promisify(execFile);
const exec = (file: string, args: string[]) => executeFile(file, args, {
  env: ISOLATED_GIT_ENV,
  timeout: 10_000,
});
const roots: string[] = [];

const GIT_TEST_TIMEOUT_MS = 15_000;
const withGitSlot = createConcurrencyLimit(2);
const gitTest = (name: string, body: () => Promise<void>) =>
  test.concurrent(name, () => withGitSlot(body), GIT_TEST_TIMEOUT_MS);

afterAll(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFeatureRepository() {
  const root = await mkdtemp(path.join(tmpdir(), "review-change-target-"));
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

describe("standalone Review change target resolution", () => {
  test("freezes pull-request metadata to the exact actual-head object", async () => {
    const baseRefOid = "a".repeat(40);
    const headRefOid = "b".repeat(40);
    const operations: string[] = [];
    let fetched = false;

    const target = await resolveAcquiredGitHubTarget({
      cwd: "/reviews/app",
      githubTarget: { kind: "pull-request", owner: "acme", repository: "app", number: 42 },
      executeProviderFile: async (file, args) => {
        operations.push(`${file} ${args.join(" ")}`);
        return { stdout: JSON.stringify({
          baseRefOid,
          headRefOid,
          headRepository: { nameWithOwner: "contributor/app" },
        }) };
      },
      executeGitFile: async (file, args) => {
        operations.push(`${file} ${args.join(" ")}`);
        const reference = args.at(-1);
        if (args.includes("fetch")) {
          fetched = true;
          return { stdout: "" };
        }
        if (reference === `${baseRefOid}^{commit}`) return { stdout: `${baseRefOid}\n` };
        if (reference?.endsWith("^{commit}") && fetched) return { stdout: `${headRefOid}\n` };
        throw Object.assign(new Error("missing object"), { code: 128 });
      },
    });

    expect({ target, operations }).toEqual({
      target: {
        kind: "pull-request",
        target: "https://github.com/acme/app/pull/42",
        immutableRange: `${baseRefOid}...${headRefOid}`,
        selectedHeadOid: headRefOid,
        headRepository: { owner: "contributor", repository: "app" },
      },
      operations: [
        "gh pr view 42 --repo acme/app --json baseRefOid,headRefOid,headRepository",
        `git -C /reviews/app rev-parse --verify ${baseRefOid}^{commit}`,
        "git -C /reviews/app fetch origin +refs/pull/42/head:refs/review-change/pull/42/head",
        "git -C /reviews/app rev-parse --verify refs/review-change/pull/42/head^{commit}",
      ],
    });
  });

  test("verifies the acquired pull ref when the provider head object already exists", async () => {
    const baseRefOid = "a".repeat(40);
    const headRefOid = "b".repeat(40);
    const operations: string[] = [];

    const target = await resolveAcquiredGitHubTarget({
      cwd: "/reviews/app",
      githubTarget: { kind: "pull-request", owner: "acme", repository: "app", number: 42 },
      executeProviderFile: async () => ({ stdout: JSON.stringify({
        baseRefOid,
        headRefOid,
        headRepository: { nameWithOwner: "acme/app" },
      }) }),
      executeGitFile: async (_file, args) => {
        operations.push(args.slice(2).join(" "));
        const reference = args.at(-1);
        if (args.includes("fetch")) return { stdout: "" };
        if (reference === `${baseRefOid}^{commit}`) return { stdout: `${baseRefOid}\n` };
        if (reference === `${headRefOid}^{commit}`) return { stdout: `${headRefOid}\n` };
        if (reference === "refs/review-change/pull/42/head^{commit}") return { stdout: `${headRefOid}\n` };
        throw Object.assign(new Error("missing object"), { code: 128 });
      },
    });

    expect({ selectedHeadOid: target.selectedHeadOid, operations }).toEqual({
      selectedHeadOid: headRefOid,
      operations: [
        `rev-parse --verify ${baseRefOid}^{commit}`,
        `fetch origin +refs/pull/42/head:refs/review-change/pull/42/head`,
        "rev-parse --verify refs/review-change/pull/42/head^{commit}",
      ],
    });
  });

  gitTest("uses verified provider content and ignores unrelated clone refs", async () => {
    const repository = await createFeatureRepository();
    let providerCalls = 0;
    const branchContentBinding = {
      providerRepositoryId: "R_kgDOImmutable",
      canonicalRepository: { owner: "Summit-Partners", repository: "News-Service" },
      defaultBranch: { name: "main", oid: repository.main },
      selectedBranch: { name: "feature/cli", oid: repository.head },
    };
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/unrelated", repository.main]);

    const resolve = () => resolveAcquiredGitHubTarget({
      cwd: repository.root,
      githubTarget: {
        kind: "branch",
        owner: "former-owner",
        repository: "former-name",
        branch: "feature/cli",
        exactBranch: true,
      },
      branchContentBinding,
      executeProviderFile: async () => { providerCalls += 1; return { stdout: "" }; },
    });
    const firstTarget = await resolve();
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/unrelated", repository.head]);
    const secondTarget = await resolve();

    expect({ firstTarget, secondTarget, providerCalls }).toEqual({
      firstTarget: {
        kind: "remote-branch",
        target: `${repository.main}...${repository.head}`,
        immutableRange: `${repository.main}...${repository.head}`,
        selectedHeadOid: repository.head,
        providerRepositoryId: "R_kgDOImmutable",
        headRepository: { owner: "Summit-Partners", repository: "News-Service" },
      },
      secondTarget: {
        kind: "remote-branch",
        target: `${repository.main}...${repository.head}`,
        immutableRange: `${repository.main}...${repository.head}`,
        selectedHeadOid: repository.head,
        providerRepositoryId: "R_kgDOImmutable",
        headRepository: { owner: "Summit-Partners", repository: "News-Service" },
      },
      providerCalls: 0,
    });
  });

  test("rejects missing verified branch content before Git resolution", async () => {
    let gitCalls = 0;

    await expect(resolveAcquiredGitHubTarget({
      cwd: "/reviews/app",
      githubTarget: { kind: "branch", owner: "acme", repository: "app", branch: "feature/cli" },
      executeGitFile: async () => { gitCalls += 1; return { stdout: "" }; },
    })).rejects.toThrow("missing verified provider and clone branch content");

    expect(gitCalls).toBe(0);
  });

  test("stops when the acquired pull ref differs from provider metadata", async () => {
    const baseRefOid = "a".repeat(40);
    const expectedHeadOid = "b".repeat(40);
    const acquiredHeadOid = "c".repeat(40);

    await expect(resolveAcquiredGitHubTarget({
      cwd: "/reviews/app",
      githubTarget: { kind: "pull-request", owner: "acme", repository: "app", number: 42 },
      executeProviderFile: async () => ({ stdout: JSON.stringify({
        baseRefOid,
        headRefOid: expectedHeadOid,
        headRepository: { nameWithOwner: "acme/app" },
      }) }),
      executeGitFile: async (_file, args) => {
        const reference = args.at(-1);
        if (args.includes("fetch")) return { stdout: "" };
        if (reference === `${baseRefOid}^{commit}`) return { stdout: `${baseRefOid}\n` };
        if (reference === "refs/review-change/pull/42/head^{commit}") return { stdout: `${acquiredHeadOid}\n` };
        throw Object.assign(new Error("missing object"), { code: 128 });
      },
    })).rejects.toThrow("Fetched pull-request head does not match provider metadata");
  });

  gitTest("uses the default branch when the feature upstream points to itself", async () => {
    const repository = await createFeatureRepository();

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: null,
      findPullRequest: async () => null,
    });

    expect(target).toEqual({ kind: "working-state", target: `${repository.main}...${repository.head}` });
  });

  gitTest("freezes a non-origin explicit range to immutable objects", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/upstream/main", repository.main]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "upstream/main...HEAD",
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
  });

  gitTest("accepts an explicit GitHub pull-request URL", async () => {
    const repository = await createFeatureRepository();
    const pullRequest = "https://github.com/acme/app/pull/42";

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: pullRequest,
    });

    expect(target).toEqual({ kind: "pull-request", target: pullRequest });
  });

  gitTest("normalizes a GitHub pull-request URL with a tab suffix", async () => {
    const repository = await createFeatureRepository();

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "https://github.com/acme/app/pull/42/changes",
    });

    expect(target).toEqual({ kind: "pull-request", target: "https://github.com/acme/app/pull/42" });
  });

  gitTest("normalizes a concise GitHub pull-request identifier", async () => {
    const repository = await createFeatureRepository();

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "gh:acme/app/pull/42",
    });

    expect(target).toEqual({ kind: "pull-request", target: "https://github.com/acme/app/pull/42" });
  });

  gitTest("freezes an explicit GitHub branch against the remote default branch", async () => {
    const repository = await createFeatureRepository();

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "https://github.com/acme/app/tree/feature/cli",
    });

    expect(target).toEqual({ kind: "remote-branch", target: `${repository.main}...${repository.head}` });
  });

  gitTest("rejects a path suffix on a concise GitHub branch identifier", async () => {
    const repository = await createFeatureRepository();

    await expect(resolveReviewTarget({
      cwd: repository.root,
      target: "gh:acme/app/tree/feature/cli/src/file.txt",
    })).rejects.toThrow("GitHub branch target not found");
  });

  gitTest("uses the longest existing branch prefix from a GitHub tree URL", async () => {
    const repository = await createFeatureRepository();

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "https://github.com/acme/app/tree/feature/cli/src/file.txt",
    });

    expect(target).toEqual({ kind: "remote-branch", target: `${repository.main}...${repository.head}` });
  });

  gitTest("prefers an exact local pull branch over pull-request shorthand", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "branch", "pull/59", repository.head]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "pull/59",
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
  });

  gitTest("prefers an exact numeric local branch over pull-request shorthand", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "branch", "59", repository.head]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "59",
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
  });

  gitTest("resolves pull shorthand against the GitHub origin", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "remote", "add", "origin", "https://github.com/acme/app.git"]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "pull/59",
    });

    expect(target).toEqual({ kind: "pull-request", target: "https://github.com/acme/app/pull/59" });
  });

  gitTest("resolves bare-number shorthand against the same GitHub origin", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "remote", "add", "origin", "git@github.com:acme/app.git"]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "59",
    });

    expect(target).toEqual({ kind: "pull-request", target: "https://github.com/acme/app/pull/59" });
  });

  gitTest("rejects noncanonical pull-request shorthand before remote discovery", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "remote", "add", "origin", "https://github.com/acme/app.git"]);

    for (const target of ["0", "01", "2147483648", "pull/0", "pull/01", "pull/2147483648"]) {
      const activity: string[] = [];
      await expect(resolveReviewTarget({
        cwd: repository.root,
        target,
        onActivity: (kind, message) => activity.push(`${kind}:${message}`),
      })).rejects.toThrow("canonical positive decimal");
      expect(activity.some((entry) => entry.includes("git remote"))).toBe(false);
    }
  });

  gitTest("prefers a GitHub origin when other GitHub remotes exist", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "remote", "add", "origin", "git@github.com:acme/app.git"]);
    await exec("git", ["-C", repository.root, "remote", "add", "upstream", "https://github.com/acme/upstream.git"]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "pull/59",
    });

    expect(target).toEqual({ kind: "pull-request", target: "https://github.com/acme/app/pull/59" });
  });

  test("ignores a control-bearing preferred origin without source-side effects", async () => {
    const operations: string[] = [];
    const target = await resolveReviewTarget({
      cwd: "/source",
      target: "59",
      executeGitFile: async (_file, args) => {
        const operation = args.slice(2).join(" ");
        operations.push(operation);
        if (operation === "rev-parse --verify refs/heads/59^{commit}") {
          throw Object.assign(new Error("missing branch"), { code: 128 });
        }
        if (operation === "remote") return { stdout: "origin\nreview\n" };
        if (operation === "remote get-url origin") {
          return { stdout: "https://github.com/acme/de\tcoy.git\n" };
        }
        if (operation === "remote get-url review") {
          return { stdout: "ssh://git@github.com/acme/app.git\n" };
        }
        throw new Error(`Unexpected Git operation: ${operation}`);
      },
    });

    expect({ target, operations }).toEqual({
      target: { kind: "pull-request", target: "https://github.com/acme/app/pull/59" },
      operations: [
        "rev-parse --verify refs/heads/59^{commit}",
        "remote",
        "remote get-url origin",
        "remote get-url review",
      ],
    });
  });

  test("rejects leading and trailing controls in raw remote URL records", async () => {
    const controls = [
      ...Array.from({ length: 0x20 }, (_value, codePoint) => String.fromCodePoint(codePoint)),
      "\u007f",
    ];
    const remotes = [
      "https://github.com/acme/decoy.git",
      "ssh://git@github.com/acme/decoy.git",
      "git@github.com:acme/decoy.git",
    ];
    const acceptedMalformedRemotes: string[] = [];

    for (const remote of remotes) {
      for (const control of controls) {
        for (const malformedRemote of [`${control}${remote}`, `${remote}${control}`]) {
          const target = await resolveReviewTarget({
            cwd: "/source",
            target: "59",
            executeGitFile: async (_file, args) => {
              const operation = args.slice(2).join(" ");
              if (operation === "rev-parse --verify refs/heads/59^{commit}") {
                throw Object.assign(new Error("missing branch"), { code: 128 });
              }
              if (operation === "remote") return { stdout: "origin\nreview\n" };
              if (operation === "remote get-url origin") return { stdout: `${malformedRemote}\n` };
              if (operation === "remote get-url review") {
                return { stdout: "https://github.com/acme/app.git\n" };
              }
              throw new Error(`Unexpected Git operation: ${operation}`);
            },
          });
          if (target.target.includes("/decoy/")) acceptedMalformedRemotes.push(JSON.stringify(malformedRemote));
        }
      }
    }

    expect(acceptedMalformedRemotes).toEqual([]);
  });

  gitTest("uses the only GitHub remote when origin is not GitHub", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "remote", "add", "origin", "git@git.sr.ht:~acme/app"]);
    await exec("git", ["-C", repository.root, "remote", "add", "review", "ssh://git@github.com/acme/app.git"]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "pull/59",
    });

    expect(target).toEqual({ kind: "pull-request", target: "https://github.com/acme/app/pull/59" });
  });

  gitTest("ignores ambiguous GitHub endpoints during remote selection", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "remote", "add", "origin", "https://github.com:8443/acme/decoy.git"]);
    await exec("git", ["-C", repository.root, "remote", "add", "review", "ssh://git@github.com:22/acme/app.git"]);

    const target = await resolveReviewTarget({ cwd: repository.root, target: "59" });

    expect(target).toEqual({ kind: "pull-request", target: "https://github.com/acme/app/pull/59" });
  });

  gitTest("rejects pull shorthand without a GitHub remote", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "remote", "add", "origin", "git@git.sr.ht:~acme/app"]);

    await expect(resolveReviewTarget({
      cwd: repository.root,
      target: "pull/59",
    })).rejects.toThrow("requires a GitHub remote");
  });

  gitTest("rejects pull shorthand across multiple non-origin GitHub remotes", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "remote", "add", "origin", "git@git.sr.ht:~acme/app"]);
    await exec("git", ["-C", repository.root, "remote", "add", "first", "git@github.com:acme/first.git"]);
    await exec("git", ["-C", repository.root, "remote", "add", "second", "git@github.com:acme/second.git"]);

    await expect(resolveReviewTarget({
      cwd: repository.root,
      target: "pull/59",
    })).rejects.toThrow("ambiguous across multiple GitHub remotes");
  });

  gitTest("freezes a local branch name and reports source-resolution activity", async () => {
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

  gitTest("freezes the local descendant when it is ahead of fetched remote state", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/feature/cli", repository.main]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "feature/cli",
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
  });

  gitTest("does not let explicit origin spelling force an older tip", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/feature/cli", repository.main]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "origin/feature/cli",
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
  });

  gitTest("rethrows operational ancestry failures with corrective diagnostics", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/feature/cli", repository.main]);

    for (const failure of [
      Object.assign(new Error("fatal: invalid commit graph"), { code: 128 }),
      Object.assign(new Error("Git ancestry check timed out"), { code: "ETIMEDOUT" }),
    ]) {
      await expect(resolveReviewTarget({
        cwd: repository.root,
        target: "feature/cli",
        executeGitFile: async (file, args, options) => {
          if (args.includes("--is-ancestor")) throw failure;
          return executeFile(file, args, options);
        },
      })).rejects.toThrow("Git ancestry check failed; repair the repository and retry");
    }
  });

  gitTest("rejects diverged local and fetched remote branch tips", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "switch", "main"]);
    await writeFile(path.join(repository.root, "file.txt"), "diverged remote\n");
    await exec("git", ["-C", repository.root, "commit", "-am", "diverged remote"]);
    const remoteHead = (await exec("git", ["-C", repository.root, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/feature/cli", remoteHead]);

    await expect(resolveReviewTarget({
      cwd: repository.root,
      target: "feature/cli",
    })).rejects.toThrow("have diverged");
  });

  gitTest("freezes the fetched remote descendant when it is ahead of the local branch", async () => {
    const repository = await createFeatureRepository();
    await writeFile(path.join(repository.root, "file.txt"), "remote descendant\n");
    await exec("git", ["-C", repository.root, "commit", "-am", "remote descendant"]);
    const remoteHead = (await exec("git", ["-C", repository.root, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/feature/cli", remoteHead]);
    await exec("git", ["-C", repository.root, "reset", "--hard", repository.head]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "feature/cli",
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${remoteHead}` });
  });

  gitTest("records the selected descendant for local materialization", async () => {
    const repository = await createFeatureRepository();

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "feature/cli",
      materializeSelectedHead: true,
    });

    expect(target).toEqual({
      kind: "local-range",
      target: `${repository.main}...${repository.head}`,
      immutableRange: `${repository.main}...${repository.head}`,
      selectedHeadOid: repository.head,
    });
  });

  gitTest("records the exact selected origin descendant for materialization", async () => {
    const repository = await createFeatureRepository();
    await writeFile(path.join(repository.root, "file.txt"), "origin descendant\n");
    await exec("git", ["-C", repository.root, "commit", "-am", "origin descendant"]);
    const originHead = (await exec("git", ["-C", repository.root, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/feature/cli", originHead]);
    await exec("git", ["-C", repository.root, "reset", "--hard", repository.head]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "origin/feature/cli",
      materializeSelectedHead: true,
    });

    expect(target).toMatchObject({
      target: `${repository.main}...${originHead}`,
      selectedHeadOid: originHead,
    });
  });

  gitTest("uses the repository default branch instead of a non-self upstream", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "switch", "-c", "integration"]);
    await writeFile(path.join(repository.root, "integration.txt"), "integration\n");
    await exec("git", ["-C", repository.root, "add", "integration.txt"]);
    await exec("git", ["-C", repository.root, "commit", "-m", "integration"]);
    const integration = (await exec("git", ["-C", repository.root, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", repository.root, "remote", "add", "origin", "https://example.invalid/repository.git"]);
    await exec("git", ["-C", repository.root, "update-ref", "refs/remotes/origin/integration", integration]);
    await exec("git", ["-C", repository.root, "switch", "feature/cli"]);
    await exec("git", ["-C", repository.root, "config", "branch.feature/cli.merge", "refs/heads/integration"]);

    const target = await resolveReviewTarget({ cwd: repository.root, target: "feature/cli" });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
  });

  gitTest("defers every mutable local branch base until isolated fetch", async () => {
    const repository = await createFeatureRepository();

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "feature/cli",
      deferBranchFreshness: true,
    });

    expect(target).toEqual({ kind: "local-branch", target: "feature/cli" });
  });

  gitTest("defers an untracked origin branch until isolated fetch", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "switch", "main"]);
    await exec("git", ["-C", repository.root, "branch", "-D", "feature/cli"]);
    await exec("git", ["-C", repository.root, "update-ref", "-d", "refs/remotes/origin/feature/cli"]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "origin/feature/cli",
      deferBranchFreshness: true,
    });

    expect(target).toEqual({ kind: "local-branch", target: "origin/feature/cli" });
  });

  gitTest("freezes a remote branch name from its merge-base with the default branch", async () => {
    const repository = await createFeatureRepository();
    await exec("git", ["-C", repository.root, "switch", "main"]);
    await exec("git", ["-C", repository.root, "branch", "-D", "feature/cli"]);

    const target = await resolveReviewTarget({
      cwd: repository.root,
      target: "feature/cli",
    });

    expect(target).toEqual({ kind: "local-range", target: `${repository.main}...${repository.head}` });
  });

  gitTest("preserves working-state scope when only dirty changes differ from the base", async () => {
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

  gitTest("prefers the current branch pull request for a targetless run", async () => {
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
