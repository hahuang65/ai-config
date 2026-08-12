import { afterAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import {
  acquireGitHubRepository,
  classifyRemoteTrust,
  createReviewWorkspace,
  defaultReviewWorkspaceRoot,
  safeRemoteUrl,
} from "../skills/review-change/runtime/workspace.mjs";
import { resolveReviewTarget } from "../skills/review-change/runtime/target.mjs";
import { createConcurrencyLimit } from "./concurrency-limit";
import { ISOLATED_GIT_ENV, isolateTestGitConfiguration } from "./git-environment";

isolateTestGitConfiguration();
const executeFile = promisify(execFile);
const exec = (file: string, args: string[]) => executeFile(file, args, {
  env: ISOLATED_GIT_ENV,
  timeout: 10_000,
});
const cleanups: Array<() => Promise<void>> = [];

const GIT_TEST_TIMEOUT_MS = 15_000;
const withGitSlot = createConcurrencyLimit(2);
const workspaceTest = (name: string, body: () => void | Promise<void>) =>
  test.concurrent(name, () => withGitSlot(body), GIT_TEST_TIMEOUT_MS);

afterAll(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

describe("standalone Review change remote metadata", () => {
  workspaceTest("refreshes canonical provider metadata by immutable ID after a no-checkout clone", async () => {
    const providerInvocations: Array<{ command: string; args: string[]; cwd?: string }> = [];
    let gitArguments: string[] = [];

    const acquisition = await acquireGitHubRepository(
      {
        owner: "former-owner",
        repository: "private-app",
        workspace: "/reviews/private-app",
        onActivity() {},
      },
      {
        executeFile: async (command, args, options) => {
          providerInvocations.push({ command, args, cwd: options.cwd });
          if (args[1] === "view") {
            return { stdout: JSON.stringify({ id: "R_kgDOImmutable", nameWithOwner: "Acme/Private-App" }) };
          }
          if (args[0] === "api") {
            return { stdout: JSON.stringify({
              data: { node: { id: "R_kgDOImmutable", nameWithOwner: "Acme/Private-App" } },
            }) };
          }
          return { stdout: "" };
        },
        runGit: async (args) => { gitArguments = args; },
      },
    );

    expect({ acquisition, providerInvocations, gitArguments }).toEqual({
      acquisition: {
        pushDisabled: true,
        providerRepository: {
          id: "R_kgDOImmutable",
          owner: "Acme",
          repository: "Private-App",
        },
      },
      providerInvocations: [
        {
          command: "gh",
          args: ["repo", "view", "former-owner/private-app", "--json", "id,nameWithOwner"],
          cwd: undefined,
        },
        {
          command: "gh",
          args: ["repo", "clone", "former-owner/private-app", "/reviews/private-app", "--", "--no-checkout"],
          cwd: undefined,
        },
        {
          command: "gh",
          args: [
            "api", "graphql", "--field", expect.stringContaining("query="),
            "--field", "id=R_kgDOImmutable",
          ],
          cwd: undefined,
        },
      ],
      gitArguments: ["-C", "/reviews/private-app", "remote", "set-url", "--push", "origin", "no-push://review-change"],
    });
  });

  workspaceTest("accepts a requested alias when immutable-ID metadata resolves its current canonical identity", async () => {
    const acquisition = await acquireGitHubRepository(
      {
        owner: "former-owner",
        repository: "former-name",
        workspace: "/reviews/renamed",
      },
      {
        executeFile: async (_command, args) => {
          if (args.includes("clone")) return { stdout: "" };
          if (args[0] === "api") {
            return { stdout: JSON.stringify({
              data: { node: { id: "R_kgDOSameRepository", nameWithOwner: "ACME/Renamed-Again" } },
            }) };
          }
          return { stdout: JSON.stringify({
            id: "R_kgDOSameRepository",
            nameWithOwner: "Acme/Current-Name",
          }) };
        },
        runGit: async () => {},
      },
    );

    expect(acquisition.providerRepository).toEqual({
      id: "R_kgDOSameRepository",
      owner: "ACME",
      repository: "Renamed-Again",
    });
  });

  workspaceTest("fails closed and cleans acquisition when the immutable provider lookup returns a different repository ID", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-repository-race-"));
    const reviewRoot = path.join(root, "reviews");
    const lifecycle: string[] = [];
    let materializations = 0;
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    await expect(createReviewWorkspace(
      {
        githubTarget: { kind: "branch", owner: "acme", repository: "app", branch: "feature" },
        reviewRoot,
      },
      {
        acquireGitHubRepository: (options) => acquireGitHubRepository(options, {
          executeFile: async (_command, args) => {
            lifecycle.push(args.join(" "));
            if (args.includes("clone")) return { stdout: "" };
            if (args[0] === "api") {
              return { stdout: JSON.stringify({
                data: { node: { id: "R_kgDOReplacement", nameWithOwner: "acme/app" } },
              }) };
            }
            return { stdout: JSON.stringify({ id: "R_kgDOOriginal", nameWithOwner: "acme/app" }) };
          },
          runGit: async () => {},
        }),
        materializeGitHead: async () => { materializations += 1; },
      },
    )).rejects.toThrow("malformed immutable repository metadata");

    expect({ lifecycle, materializations, retainedWorkspaces: await readdir(reviewRoot) }).toEqual({
      lifecycle: [
        "repo view acme/app --json id,nameWithOwner",
        expect.stringContaining("repo clone acme/app"),
        expect.stringContaining("api graphql --field query="),
      ],
      materializations: 0,
      retainedWorkspaces: [],
    });
  });

  workspaceTest("rejects malformed immutable repository IDs before clone", async () => {
    const malformedIds = [null, 42, "", "repository id", "R_kgDOUnsafe\n"];
    let cloneCalls = 0;

    for (const id of malformedIds) {
      await expect(acquireGitHubRepository(
        { owner: "acme", repository: "app", workspace: "/reviews/app" },
        {
          executeFile: async (_command, args) => {
            if (args.includes("clone")) cloneCalls += 1;
            return { stdout: JSON.stringify({ id, nameWithOwner: "acme/app" }) };
          },
          runGit: async () => {},
        },
      )).rejects.toThrow("malformed repository metadata");
    }

    expect(cloneCalls).toBe(0);
  });

  workspaceTest("cleans the recorded workspace when provider identity resolution fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-provider-failure-"));
    const reviewRoot = path.join(root, "reviews");
    let cloneCalls = 0;
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    await expect(createReviewWorkspace(
      {
        githubTarget: { kind: "branch", owner: "acme", repository: "app", branch: "feature" },
        reviewRoot,
      },
      {
        acquireGitHubRepository: (options) => acquireGitHubRepository(options, {
          executeFile: async (_command, args) => {
            if (args.includes("clone")) cloneCalls += 1;
            throw new Error("provider unavailable");
          },
          runGit: async () => {},
        }),
      },
    )).rejects.toThrow("provider unavailable");

    expect({ cloneCalls, retainedWorkspaces: await readdir(reviewRoot) }).toEqual({
      cloneCalls: 0,
      retainedWorkspaces: [],
    });
  });

  workspaceTest("cleans without materialization when provider validation fails after clone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-post-clone-provider-failure-"));
    const reviewRoot = path.join(root, "reviews");
    let providerViews = 0;
    let materializations = 0;
    cleanups.push(() => rm(root, { recursive: true, force: true }));

    await expect(createReviewWorkspace(
      {
        githubTarget: { kind: "branch", owner: "acme", repository: "app", branch: "feature" },
        reviewRoot,
      },
      {
        acquireGitHubRepository: (options) => acquireGitHubRepository(options, {
          executeFile: async (_command, args) => {
            if (args.includes("clone")) return { stdout: "" };
            providerViews += 1;
            if (providerViews === 2) throw new Error("post-clone provider failure");
            return { stdout: JSON.stringify({ id: "R_kgDOApp", nameWithOwner: "acme/app" }) };
          },
          runGit: async () => {},
        }),
        materializeGitHead: async () => { materializations += 1; },
      },
    )).rejects.toThrow("post-clone provider failure");

    expect({ materializations, retainedWorkspaces: await readdir(reviewRoot) }).toEqual({
      materializations: 0,
      retainedWorkspaces: [],
    });
  });

  workspaceTest("grants A5 trust only from effective global or system configuration", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-trust-scope-"));
    const repositoryRoot = path.join(root, "repository");
    const temporaryRoot = path.join(root, "contexts");
    const invocations: string[][] = [];
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await Promise.all([mkdir(repositoryRoot), mkdir(temporaryRoot)]);
    const classify = (stdout: string) => classifyRemoteTrust(
      { repositoryRoot, headRepository: { owner: "summit-partners", repository: "news-service" } },
      {
        temporaryRoot,
        executeFile: async (_file, args) => { invocations.push(args); return { stdout }; },
      },
    );

    const globalTrust = await classify("global\tfile:/Users/example/.gitconfig\ta5\n");
    const localTrust = await classify("local\tfile:.git/config\ta5\n");
    const realTemporaryRoot = await realpath(temporaryRoot);

    expect({
      globalTrust,
      localTrust,
      commandScopedUrls: invocations.map((args) => args[2]),
      independentGitDirs: invocations.every((args) => args[0].startsWith(`--git-dir=${realTemporaryRoot}`)),
    }).toEqual({
      globalTrust: { trusted: true, reason: "a5" },
      localTrust: { trusted: false, reason: "untrusted" },
      commandScopedUrls: [
        "remote.review-change-classification.url=git@github.com:summit-partners/news-service.git",
        "remote.review-change-classification.url=git@github.com:summit-partners/news-service.git",
      ],
      independentGitDirs: true,
    });
  });

  workspaceTest("cleans the exact allocated trust context when canonicalization fails", async () => {
    const allocatedContext = "/temporary/review-change-classification-exact";
    const removedPaths: string[] = [];
    let failure: Error | null = null;

    try {
      await classifyRemoteTrust(
        {
          repositoryRoot: "/review/repository",
          headRepository: { owner: "external", repository: "fork" },
        },
        {
          makeTemporaryDirectory: async () => allocatedContext,
          resolveRealPath: async (candidate) => {
            if (candidate === allocatedContext) throw new Error("canonicalization failed");
            return candidate;
          },
          removeDirectory: async (recordedPath) => { removedPaths.push(recordedPath); },
          executeFile: async () => { throw new Error("Git must not run"); },
        },
      );
    } catch (error) {
      failure = error as Error;
    }

    expect({ message: failure?.message, removedPaths }).toEqual({
      message: "canonicalization failed",
      removedPaths: [allocatedContext],
    });
  });

  workspaceTest("cleans the exact allocated trust context when activity reporting fails", async () => {
    const allocatedContext = "/temporary/review-change-classification-activity";
    const removedPaths: string[] = [];
    let failure: Error | null = null;

    try {
      await classifyRemoteTrust(
        {
          repositoryRoot: "/review/repository",
          headRepository: { owner: "external", repository: "fork" },
          onActivity: () => { throw new Error("activity reporting failed"); },
        },
        {
          makeTemporaryDirectory: async () => allocatedContext,
          resolveRealPath: async (candidate) => candidate,
          removeDirectory: async (recordedPath) => { removedPaths.push(recordedPath); },
          executeFile: async () => { throw new Error("Git must not run"); },
        },
      );
    } catch (error) {
      failure = error as Error;
    }

    expect({ message: failure?.message, removedPaths }).toEqual({
      message: "activity reporting failed",
      removedPaths: [allocatedContext],
    });
  });

  workspaceTest("cleans only the exact allocated trust context after successful classification", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-trust-cleanup-"));
    const repositoryRoot = path.join(root, "repository");
    const temporaryRoot = path.join(root, "classification-contexts");
    const decoy = path.join(temporaryRoot, "keep-this-path");
    const removedPaths: string[] = [];
    let allocatedContext: string | null = null;
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await Promise.all([mkdir(repositoryRoot), mkdir(decoy, { recursive: true })]);

    const classification = await classifyRemoteTrust(
      { repositoryRoot, headRepository: { owner: "external", repository: "fork" } },
      {
        temporaryRoot,
        makeTemporaryDirectory: async (prefix) => {
          allocatedContext = await mkdtemp(prefix);
          return allocatedContext;
        },
        executeFile: async () => ({ stdout: "global\tfile:/Users/example/.gitconfig\ta5\n" }),
        removeDirectory: async (recordedPath, options) => {
          removedPaths.push(recordedPath);
          await rm(recordedPath, options);
        },
      },
    );

    expect({
      classification,
      removedPaths,
      contextIsOutsideBase: !removedPaths[0].startsWith(`${repositoryRoot}${path.sep}`),
      decoyExists: (await stat(decoy)).isDirectory(),
    }).toEqual({
      classification: { trusted: true, reason: "a5" },
      removedPaths: [allocatedContext],
      contextIsOutsideBase: true,
      decoyExists: true,
    });
  });

  workspaceTest("does not inherit a global gitdir A5 include from the acquired base repository", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-trust-base-"));
    const repositoryRoot = path.join(root, "repository");
    const globalConfig = path.join(root, "global.gitconfig");
    const a5Config = path.join(root, "a5.gitconfig");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", repositoryRoot]);
    await exec("git", ["config", "--file", a5Config, "ai.projectFamily", "a5"]);
    await exec("git", [
      "config", "--file", globalConfig,
      `includeIf.gitdir:${await realpath(repositoryRoot)}/**.path`, a5Config,
    ]);
    await exec("git", ["-C", repositoryRoot, "remote", "add", "origin", "git@github.com:summit-partners/base.git"]);
    const configuredGit = async (file, args, options) => {
      const environment = { ...ISOLATED_GIT_ENV, GIT_CONFIG_GLOBAL: globalConfig };
      const gitDirectory = args[0]?.startsWith("--git-dir=") ? args[0].slice("--git-dir=".length) : null;
      if (gitDirectory) await executeFile("git", ["init", "--bare", gitDirectory], { env: environment });
      return executeFile(file, args, { ...options, env: environment });
    };

    const classification = await classifyRemoteTrust(
      { repositoryRoot, headRepository: { owner: "external", repository: "fork" } },
      { executeFile: configuredGit },
    );

    expect(classification).toEqual({ trusted: false, reason: "untrusted" });
  });

  workspaceTest("grants A5 trust from the actual head fork identity", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-trust-fork-"));
    const repositoryRoot = path.join(root, "repository");
    const globalConfig = path.join(root, "global.gitconfig");
    const a5Config = path.join(root, "a5.gitconfig");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", repositoryRoot]);
    await exec("git", ["config", "--file", a5Config, "ai.projectFamily", "a5"]);
    await exec("git", [
      "config", "--file", globalConfig,
      "includeIf.hasconfig:remote.*.url:git@github.com:summit-partners/**.path", a5Config,
    ]);
    await exec("git", ["-C", repositoryRoot, "remote", "add", "origin", "git@github.com:external/base.git"]);
    const configuredGit = (file, args, options) => executeFile(file, args, {
      ...options,
      env: { ...ISOLATED_GIT_ENV, GIT_CONFIG_GLOBAL: globalConfig },
    });

    const classification = await classifyRemoteTrust(
      { repositoryRoot, headRepository: { owner: "summit-partners", repository: "fork" } },
      { executeFile: configuredGit },
    );

    expect(classification).toEqual({ trusted: true, reason: "a5" });
  });

  workspaceTest("retains only credential-safe fetch URLs", () => {
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
  workspaceTest("keeps review isolation separate from development worktrees", () => {
    expect(defaultReviewWorkspaceRoot("/Users/example")).toBe("/Users/example/.review-orchard");
  });

  workspaceTest("fetches current remote state only inside the disposable review workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-fetch-"));
    const remote = path.join(root, "remote.git");
    const seed = path.join(root, "seed");
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "--bare", remote]);
    await exec("git", ["init", "-b", "main", seed]);
    await exec("git", ["-C", seed, "config", "user.name", "Test User"]);
    await exec("git", ["-C", seed, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(seed, "tracked.txt"), "main\n");
    await exec("git", ["-C", seed, "add", "tracked.txt"]);
    await exec("git", ["-C", seed, "commit", "-m", "main"]);
    await exec("git", ["-C", seed, "switch", "-c", "feature/cli"]);
    await writeFile(path.join(seed, "tracked.txt"), "initial feature\n");
    await exec("git", ["-C", seed, "commit", "-am", "initial feature"]);
    const remoteUrl = pathToFileURL(remote).href;
    await exec("git", ["-C", seed, "remote", "add", "origin", remoteUrl]);
    await exec("git", ["-C", seed, "push", "origin", "main", "feature/cli"]);
    await exec("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
    await exec("git", ["clone", "--branch", "feature/cli", remoteUrl, source]);
    const staleSourceTip = (await exec("git", ["-C", source, "rev-parse", "refs/remotes/origin/feature/cli"])).stdout.trim();
    const fetchHeadPath = path.join(source, ".git", "FETCH_HEAD");
    const fetchHeadBefore = await readFile(fetchHeadPath, "utf8").catch(() => null);
    await writeFile(path.join(seed, "tracked.txt"), "current feature\n");
    await exec("git", ["-C", seed, "commit", "-am", "current feature"]);
    await exec("git", ["-C", seed, "push", "origin", "feature/cli"]);
    const currentRemoteTip = (await exec("git", ["-C", seed, "rev-parse", "HEAD"])).stdout.trim();

    const workspace = await createReviewWorkspace({ cwd: source, reviewRoot, fetchRemote: true });
    const workspaceRemoteTip = (await exec("git", ["-C", workspace.cwd, "rev-parse", "refs/remotes/origin/feature/cli"])).stdout.trim();
    const sourceRemoteTip = (await exec("git", ["-C", source, "rev-parse", "refs/remotes/origin/feature/cli"])).stdout.trim();
    const fetchHeadAfter = await readFile(fetchHeadPath, "utf8").catch(() => null);

    expect({ workspaceRemoteTip, sourceRemoteTip, fetchHeadAfter }).toEqual({
      workspaceRemoteTip: currentRemoteTip,
      sourceRemoteTip: staleSourceTip,
      fetchHeadAfter: fetchHeadBefore,
    });
  });

  workspaceTest("fetches a local branch matching non-origin remote and uses that remote default", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-matching-remote-"));
    const origin = path.join(root, "origin.git");
    const upstream = path.join(root, "upstream.git");
    const seed = path.join(root, "seed");
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await Promise.all([
      exec("git", ["init", "--bare", origin]),
      exec("git", ["init", "--bare", upstream]),
    ]);
    await exec("git", ["init", "-b", "main", seed]);
    await exec("git", ["-C", seed, "config", "user.name", "Test User"]);
    await exec("git", ["-C", seed, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(seed, "tracked.txt"), "base\n");
    await exec("git", ["-C", seed, "add", "tracked.txt"]);
    await exec("git", ["-C", seed, "commit", "-m", "base"]);
    const base = (await exec("git", ["-C", seed, "rev-parse", "HEAD"])).stdout.trim();
    const originUrl = pathToFileURL(origin).href;
    const upstreamUrl = pathToFileURL(upstream).href;
    await exec("git", ["-C", seed, "remote", "add", "origin", originUrl]);
    await exec("git", ["-C", seed, "remote", "add", "upstream", upstreamUrl]);
    await exec("git", ["-C", seed, "push", "origin", "main"]);
    await exec("git", ["-C", seed, "push", "upstream", "main"]);
    await exec("git", ["--git-dir", origin, "symbolic-ref", "HEAD", "refs/heads/main"]);
    await exec("git", ["--git-dir", upstream, "symbolic-ref", "HEAD", "refs/heads/main"]);
    await exec("git", ["-C", seed, "switch", "-c", "feature/cli"]);
    await writeFile(path.join(seed, "tracked.txt"), "stale upstream feature\n");
    await exec("git", ["-C", seed, "commit", "-am", "stale upstream feature"]);
    const staleUpstreamTip = (await exec("git", ["-C", seed, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", seed, "push", "upstream", "feature/cli"]);
    await exec("git", ["clone", "--branch", "feature/cli", upstreamUrl, source]);
    await exec("git", ["-C", source, "remote", "rename", "origin", "upstream"]);
    await exec("git", ["-C", source, "remote", "add", "origin", originUrl]);
    await exec("git", ["-C", source, "fetch", "origin"]);
    await exec("git", ["-C", seed, "reset", "--hard", base]);
    await writeFile(path.join(seed, "tracked.txt"), "origin feature\n");
    await exec("git", ["-C", seed, "commit", "-am", "origin feature"]);
    await exec("git", ["-C", seed, "push", "origin", "HEAD:feature/cli"]);
    await exec("git", ["-C", seed, "reset", "--hard", staleUpstreamTip]);
    await writeFile(path.join(seed, "tracked.txt"), "fresh upstream feature\n");
    await exec("git", ["-C", seed, "commit", "-am", "fresh upstream feature"]);
    const freshUpstreamTip = (await exec("git", ["-C", seed, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", seed, "push", "upstream", "HEAD:feature/cli"]);

    const deferredScope = await resolveReviewTarget({
      cwd: source,
      target: "feature/cli",
      deferBranchFreshness: true,
    });
    const workspace = await createReviewWorkspace({
      cwd: source,
      reviewRoot,
      fetchRemote: true,
      freshnessRemote: deferredScope.freshnessRemote,
    });
    const scope = await resolveReviewTarget({
      cwd: workspace.cwd,
      target: "feature/cli",
      freshnessRemote: deferredScope.freshnessRemote,
    });
    const sourceUpstreamTip = (await exec(
      "git", ["-C", source, "rev-parse", "refs/remotes/upstream/feature/cli"],
    )).stdout.trim();

    expect({ deferredScope, scope, sourceUpstreamTip }).toEqual({
      deferredScope: { kind: "local-branch", target: "feature/cli", freshnessRemote: "upstream" },
      scope: { kind: "local-range", target: `${base}...${freshUpstreamTip}` },
      sourceUpstreamTip: staleUpstreamTip,
    });
  });

  workspaceTest("uses the remote advertised default branch after isolated fetch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-default-branch-"));
    const remote = path.join(root, "remote.git");
    const seed = path.join(root, "seed");
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "--bare", remote]);
    await exec("git", ["init", "-b", "main", seed]);
    await exec("git", ["-C", seed, "config", "user.name", "Test User"]);
    await exec("git", ["-C", seed, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(seed, "tracked.txt"), "main\n");
    await exec("git", ["-C", seed, "add", "tracked.txt"]);
    await exec("git", ["-C", seed, "commit", "-m", "main"]);
    await exec("git", ["-C", seed, "switch", "-c", "develop"]);
    await writeFile(path.join(seed, "tracked.txt"), "develop\n");
    await exec("git", ["-C", seed, "commit", "-am", "develop"]);
    const develop = (await exec("git", ["-C", seed, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", seed, "switch", "-c", "feature/cli"]);
    await writeFile(path.join(seed, "tracked.txt"), "feature\n");
    await exec("git", ["-C", seed, "commit", "-am", "feature"]);
    const feature = (await exec("git", ["-C", seed, "rev-parse", "HEAD"])).stdout.trim();
    const remoteUrl = pathToFileURL(remote).href;
    await exec("git", ["-C", seed, "remote", "add", "origin", remoteUrl]);
    await exec("git", ["-C", seed, "push", "origin", "main", "develop", "feature/cli"]);
    await exec("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/main"]);
    await exec("git", ["clone", "--branch", "feature/cli", remoteUrl, source]);
    await exec("git", ["--git-dir", remote, "symbolic-ref", "HEAD", "refs/heads/develop"]);

    const workspace = await createReviewWorkspace({ cwd: source, reviewRoot, fetchRemote: true });
    const scope = await resolveReviewTarget({ cwd: workspace.cwd, target: "feature/cli" });

    expect(scope).toEqual({ kind: "local-range", target: `${develop}...${feature}` });
  });

  workspaceTest("fails closed and removes its workspace when isolated fetch fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-fetch-failure-"));
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "-b", "main", source]);
    await exec("git", ["-C", source, "config", "user.name", "Test User"]);
    await exec("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "tracked.txt"), "source\n");
    await exec("git", ["-C", source, "add", "tracked.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "source"]);
    await exec("git", ["-C", source, "remote", "add", "origin", pathToFileURL(path.join(root, "missing.git")).href]);
    let failure = null;

    try {
      await createReviewWorkspace({ cwd: source, reviewRoot, fetchRemote: true });
    } catch (error) {
      failure = error;
    }

    expect({ failed: failure instanceof Error, retainedWorkspaces: await readdir(reviewRoot) }).toEqual({
      failed: true,
      retainedWorkspaces: [],
    });
  });

  workspaceTest("records canonical SSH identity for direct GitHub acquisition", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-direct-identity-"));
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const workspace = await createReviewWorkspace(
      {
        githubTarget: { kind: "pull-request", owner: "summit-partners", repository: "news-service", number: 59 },
        reviewRoot,
      },
      { acquireGitHubRepository: async () => ({ pushDisabled: true }) },
    );

    expect(workspace.details.requestedRepositorySshUrl)
      .toBe("git@github.com:summit-partners/news-service.git");
  });

  workspaceTest("materializes the exact trusted head and cleans only recorded paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-trusted-head-"));
    const reviewRoot = path.join(root, "reviews");
    const decoy = path.join(reviewRoot, "keep-this-path");
    const selectedHeadOid = "a".repeat(40);
    const lifecycle: string[] = [];
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await mkdir(decoy, { recursive: true });
    const workspace = await createReviewWorkspace(
      {
        githubTarget: { kind: "pull-request", owner: "acme", repository: "app", number: 42 },
        reviewRoot,
      },
      {
        acquireGitHubRepository: async ({ workspace }) => {
          lifecycle.push(`acquire:${workspace}`);
          return { pushDisabled: true };
        },
        materializeGitHead: async ({ repositoryRoot, materializedPath, selectedHeadOid: oid }) => {
          lifecycle.push(`materialize:${repositoryRoot}:${materializedPath}:${oid}`);
          await mkdir(materializedPath);
        },
        removeMaterializedGitHead: async ({ repositoryRoot, materializedPath }) => {
          lifecycle.push(`remove:${repositoryRoot}:${materializedPath}`);
          await rm(materializedPath, { recursive: true });
        },
      },
    );

    const trustedWorkspace = await workspace.materializeHead(selectedHeadOid);
    await trustedWorkspace.cleanup();

    expect({
      selectedHeadOid: trustedWorkspace.details.selectedHeadOid,
      materializedPath: trustedWorkspace.details.materializedPath,
      lifecycle,
      decoyExists: (await stat(decoy)).isDirectory(),
    }).toEqual({
      selectedHeadOid,
      materializedPath: trustedWorkspace.cwd,
      lifecycle: [
        `acquire:${workspace.cwd}`,
        `materialize:${workspace.cwd}:${trustedWorkspace.cwd}:${selectedHeadOid}`,
        `remove:${workspace.cwd}:${trustedWorkspace.cwd}`,
      ],
      decoyExists: true,
    });
  });

  workspaceTest("retries only the recorded sibling path after the first post-allocation failure", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-materialized-allocation-"));
    const reviewRoot = path.join(root, "reviews");
    const allocatedPath = path.join(reviewRoot, "app-selected-head-recorded");
    const removalAttempts: string[] = [];
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const workspace = await createReviewWorkspace(
      {
        githubTarget: { kind: "pull-request", owner: "acme", repository: "app", number: 42 },
        reviewRoot,
      },
      {
        acquireGitHubRepository: async () => ({ pushDisabled: true }),
        makeMaterializedDirectory: async () => {
          await mkdir(allocatedPath);
          return allocatedPath;
        },
        removeMaterializedDirectory: async (recordedPath) => {
          removalAttempts.push(recordedPath);
          throw new Error(removalAttempts.length === 1 ? "initial removal failed" : "final removal failed");
        },
        materializeGitHead: async () => { throw new Error("materialization must not start"); },
        removeMaterializedGitHead: async () => { throw new Error("worktree removal must not run"); },
      },
    );
    let allocationFailure: Error | null = null;
    let cleanupFailure: Error | null = null;

    try {
      await workspace.materializeHead("a".repeat(40));
    } catch (error) {
      allocationFailure = error as Error;
    }
    try {
      await workspace.cleanup();
    } catch (error) {
      cleanupFailure = error as Error;
    }

    expect({
      allocationMessage: allocationFailure?.message,
      cleanupMessage: cleanupFailure?.message,
      removalAttempts,
    }).toEqual({
      allocationMessage: "initial removal failed",
      cleanupMessage: `Failed to remove recorded materialized path ${allocatedPath}: final removal failed`,
      removalAttempts: [allocatedPath, allocatedPath],
    });
  });

  workspaceTest("removes the recorded workspace when direct acquisition fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-direct-failure-"));
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    let failure = null;

    try {
      await createReviewWorkspace(
        {
          githubTarget: { kind: "pull-request", owner: "acme", repository: "app", number: 42 },
          reviewRoot,
        },
        { acquireGitHubRepository: async () => { throw new Error("repository unavailable"); } },
      );
    } catch (error) {
      failure = error;
    }

    expect({ message: failure?.message, retainedWorkspaces: await readdir(reviewRoot) }).toEqual({
      message: "repository unavailable",
      retainedWorkspaces: [],
    });
  });

  workspaceTest("removes only the recorded directly acquired workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-direct-cleanup-"));
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    const workspace = await createReviewWorkspace(
      {
        githubTarget: { kind: "pull-request", owner: "acme", repository: "app", number: 42 },
        reviewRoot,
      },
      { acquireGitHubRepository: async () => ({ pushDisabled: true }) },
    );

    await workspace.cleanup();

    await expect(stat(workspace.cwd)).rejects.toThrow();
  });

  workspaceTest("snapshots tracked and untracked working state into an isolated clone", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-source-"));
    const orchard = await mkdtemp(path.join(tmpdir(), "review-change-orchard-"));
    cleanups.push(async () => {
      await Promise.all([rm(root, { recursive: true, force: true }), rm(orchard, { recursive: true, force: true })]);
    });
    await exec("git", ["init", "-b", "feature/cli", root]);
    await exec("git", ["-C", root, "config", "user.name", "Test User"]);
    await exec("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(root, "tracked.txt"), "before\n");
    await exec("git", ["-C", root, "add", "tracked.txt"]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    await writeFile(path.join(root, "tracked.txt"), "after\n");
    await writeFile(path.join(root, "untracked.txt"), "new\n");

    const activity: string[] = [];
    const workspace = await createReviewWorkspace({
      cwd: root,
      reviewRoot: orchard,
      onActivity: (kind, message) => activity.push(`${kind}:${message}`),
    });
    cleanups.push(workspace.cleanup);

    expect(workspace.cwd).not.toBe(root);
    expect(await readFile(path.join(workspace.cwd, "tracked.txt"), "utf8")).toBe("after\n");
    expect(await readFile(path.join(workspace.cwd, "untracked.txt"), "utf8")).toBe("new\n");
    expect((await exec("git", ["-C", workspace.cwd, "branch", "--show-current"])).stdout.trim())
      .toBe("feature/cli");
    expect((await exec("git", ["-C", workspace.cwd, "config", "--local", "--get", "remote.origin.url"])).stdout.trim())
      .toBe("no-fetch://review-change");
    expect((await exec("git", ["-C", workspace.cwd, "remote", "get-url", "--push", "origin"])).stdout.trim())
      .toBe("no-push://review-change");
    expect(activity.some((entry) => entry.includes("disabled the push URL"))).toBe(true);
    expect(activity.some((entry) => entry.includes("Snapshot ready"))).toBe(true);
    await writeFile(path.join(workspace.cwd, "tracked.txt"), "isolated mutation\n");
    expect(await readFile(path.join(root, "tracked.txt"), "utf8")).toBe("after\n");
  });

  workspaceTest("materializes a clean local snapshot at the exact selected head", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-local-head-"));
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "-b", "feature/cli", source]);
    await exec("git", ["-C", source, "config", "user.name", "Test User"]);
    await exec("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "tracked.txt"), "source head\n");
    await exec("git", ["-C", source, "add", "tracked.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "source head"]);
    const sourceHead = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(source, "tracked.txt"), "selected head\n");
    await exec("git", ["-C", source, "commit", "-am", "selected head"]);
    const selectedHeadOid = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", source, "branch", "selected-descendant"]);
    await exec("git", ["-C", source, "reset", "--hard", sourceHead]);

    const workspace = await createReviewWorkspace({ cwd: source, reviewRoot });
    const selectedWorkspace = await workspace.materializeHead(selectedHeadOid);
    const materializedHead = (await exec("git", ["-C", selectedWorkspace.cwd, "rev-parse", "HEAD"])).stdout.trim();
    const materializedStatus = (await exec("git", ["-C", selectedWorkspace.cwd, "status", "--porcelain"])).stdout;

    expect({
      sameWorkspace: selectedWorkspace.cwd === workspace.cwd,
      materializedHead,
      materializedStatus,
      materializationState: selectedWorkspace.details.materializationState,
    }).toEqual({
      sameWorkspace: true,
      materializedHead: selectedHeadOid,
      materializedStatus: "",
      materializationState: "selected-head-replayed",
    });
  });

  workspaceTest("replays dirty tracked state onto the exact selected descendant", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-dirty-replay-"));
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "-b", "feature/cli", source]);
    await exec("git", ["-C", source, "config", "user.name", "Test User"]);
    await exec("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "tracked.txt"), "source head\n");
    await exec("git", ["-C", source, "add", "tracked.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "source head"]);
    const sourceHead = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(source, "selected.txt"), "selected head\n");
    await exec("git", ["-C", source, "add", "selected.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "selected head"]);
    const selectedHeadOid = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", source, "branch", "selected-descendant"]);
    await exec("git", ["-C", source, "reset", "--hard", sourceHead]);
    await writeFile(path.join(source, "tracked.txt"), "dirty source snapshot\n");

    const workspace = await createReviewWorkspace({ cwd: source, reviewRoot });
    const selectedWorkspace = await workspace.materializeHead(selectedHeadOid);

    expect({
      head: (await exec("git", ["-C", selectedWorkspace.cwd, "rev-parse", "HEAD"])).stdout.trim(),
      tracked: await readFile(path.join(selectedWorkspace.cwd, "tracked.txt"), "utf8"),
      selected: await readFile(path.join(selectedWorkspace.cwd, "selected.txt"), "utf8"),
      sourceHead: (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim(),
      sourceTracked: await readFile(path.join(source, "tracked.txt"), "utf8"),
    }).toEqual({
      head: selectedHeadOid,
      tracked: "dirty source snapshot\n",
      selected: "selected head\n",
      sourceHead,
      sourceTracked: "dirty source snapshot\n",
    });
  });

  workspaceTest("replays captured untracked files onto the selected descendant", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-untracked-replay-"));
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "-b", "feature/cli", source]);
    await exec("git", ["-C", source, "config", "user.name", "Test User"]);
    await exec("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "tracked.txt"), "source head\n");
    await exec("git", ["-C", source, "add", "tracked.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "source head"]);
    const sourceHead = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(source, "selected.txt"), "selected head\n");
    await exec("git", ["-C", source, "add", "selected.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "selected head"]);
    const selectedHeadOid = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", source, "branch", "selected-descendant"]);
    await exec("git", ["-C", source, "reset", "--hard", sourceHead]);
    await mkdir(path.join(source, "notes"));
    await writeFile(path.join(source, "notes", "review.txt"), "captured untracked state\n");

    const workspace = await createReviewWorkspace({ cwd: source, reviewRoot });
    const selectedWorkspace = await workspace.materializeHead(selectedHeadOid);

    expect({
      untracked: await readFile(path.join(selectedWorkspace.cwd, "notes", "review.txt"), "utf8"),
      selected: await readFile(path.join(selectedWorkspace.cwd, "selected.txt"), "utf8"),
    }).toEqual({
      untracked: "captured untracked state\n",
      selected: "selected head\n",
    });
  });

  workspaceTest("preserves a captured relative symlink whose target stays inside isolation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-safe-symlink-"));
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "-b", "feature", source]);
    await exec("git", ["-C", source, "config", "user.name", "Test User"]);
    await exec("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "tracked.txt"), "tracked\n");
    await exec("git", ["-C", source, "add", "tracked.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "tracked"]);
    await mkdir(path.join(source, "notes"));
    await writeFile(path.join(source, "notes", "target.txt"), "safe target\n");
    await symlink("notes/target.txt", path.join(source, "review-link.txt"));

    const workspace = await createReviewWorkspace({ cwd: source, reviewRoot });

    expect({
      target: await readlink(path.join(workspace.cwd, "review-link.txt")),
      content: await readFile(path.join(workspace.cwd, "review-link.txt"), "utf8"),
    }).toEqual({
      target: "notes/target.txt",
      content: "safe target\n",
    });
  });

  workspaceTest("stops when an untracked snapshot path becomes tracked in the selected descendant", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-untracked-conflict-"));
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "-b", "feature/cli", source]);
    await exec("git", ["-C", source, "config", "user.name", "Test User"]);
    await exec("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "tracked.txt"), "source head\n");
    await exec("git", ["-C", source, "add", "tracked.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "source head"]);
    const sourceHead = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(source, "collision.txt"), "selected tracked path\n");
    await exec("git", ["-C", source, "add", "collision.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "selected head"]);
    const selectedHeadOid = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", source, "branch", "selected-descendant"]);
    await exec("git", ["-C", source, "reset", "--hard", sourceHead]);
    await writeFile(path.join(source, "collision.txt"), "source untracked path\n");

    const workspace = await createReviewWorkspace({ cwd: source, reviewRoot });

    await expect(workspace.materializeHead(selectedHeadOid)).rejects
      .toThrow("Could not replay the source working snapshot onto the selected local head");
  });

  workspaceTest("stops when dirty tracked state conflicts with the selected descendant", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-replay-conflict-"));
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "-b", "feature/cli", source]);
    await exec("git", ["-C", source, "config", "user.name", "Test User"]);
    await exec("git", ["-C", source, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "tracked.txt"), "source head\n");
    await exec("git", ["-C", source, "add", "tracked.txt"]);
    await exec("git", ["-C", source, "commit", "-m", "source head"]);
    const sourceHead = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await writeFile(path.join(source, "tracked.txt"), "selected head\n");
    await exec("git", ["-C", source, "commit", "-am", "selected head"]);
    const selectedHeadOid = (await exec("git", ["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await exec("git", ["-C", source, "branch", "selected-descendant"]);
    await exec("git", ["-C", source, "reset", "--hard", sourceHead]);
    await writeFile(path.join(source, "tracked.txt"), "dirty source snapshot\n");

    const workspace = await createReviewWorkspace({ cwd: source, reviewRoot });

    await expect(workspace.materializeHead(selectedHeadOid)).rejects
      .toThrow("Could not replay the source working snapshot onto the selected local head");
  });

  workspaceTest("rejects a review workspace root inside the reviewed repository before creating it", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-source-"));
    cleanups.push(() => rm(root, { recursive: true, force: true }));
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.name", "Test User"]);
    await exec("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(root, "README.md"), "source\n");
    await exec("git", ["-C", root, "add", "README.md"]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const reviewRoot = path.join(root, ".review-orchard");

    await expect(createReviewWorkspace({ cwd: root, reviewRoot })).rejects
      .toThrow("review workspace root must be outside");
    await expect(stat(reviewRoot)).rejects.toThrow();
  });

  workspaceTest("removes only its recorded workspace", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-source-"));
    const orchard = await mkdtemp(path.join(tmpdir(), "review-change-orchard-"));
    await exec("git", ["init", "-b", "main", root]);
    await exec("git", ["-C", root, "config", "user.name", "Test User"]);
    await exec("git", ["-C", root, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(root, "README.md"), "source\n");
    await exec("git", ["-C", root, "add", "README.md"]);
    await exec("git", ["-C", root, "commit", "-m", "initial"]);
    const workspace = await createReviewWorkspace({ cwd: root, reviewRoot: orchard });

    await workspace.cleanup();

    await expect(stat(workspace.cwd)).rejects.toThrow();
    expect(await readFile(path.join(root, "README.md"), "utf8")).toBe("source\n");
    await Promise.all([rm(root, { recursive: true, force: true }), rm(orchard, { recursive: true, force: true })]);
  });
});
