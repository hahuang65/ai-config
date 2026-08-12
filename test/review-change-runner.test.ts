import { expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { runReviewChange } from "../skills/review-change/runtime/runner.mjs";
import { createReviewWorkspace } from "../skills/review-change/runtime/workspace.mjs";
import { ISOLATED_GIT_ENV } from "./git-environment";

const executeFile = promisify(execFile);
const git = (args: string[]) => executeFile("git", args, { env: ISOLATED_GIT_ENV, timeout: 10_000 });

test("rejects unsafe pull-request identifiers before workspace side effects", async () => {
  let workspaceCreations = 0;
  const rejectedTargets = [
    "gh:acme/app/pull/\t42",
    "gh:acme%2Fother/app/pull/42",
    "gh:acme/app%2Fother/pull/42",
    "gh:-acme/app/pull/42",
    "gh:acme/app~service/pull/42",
    "gh:acme/app/pull/0",
    "gh:acme/app/pull/2147483648",
    "gh:acme/app/pull/42/changes",
    "gh:acme/app/pull/42/",
    "gh:acme/app/pull/42?diff=split",
    "gh:acme/app/pull/42#discussion",
    "gh:acme/app/tree/feature/cli/",
    "gh:acme/app/tree/feature/cli?plain=1",
    "gh:acme/app/tree/feature/cli#readme",
    "0",
    "01",
    "2147483648",
    "pull/0",
    "pull/01",
    "pull/2147483648",
  ];
  const errors = [];

  for (const target of rejectedTargets) {
    try {
      await runReviewChange(
        { target, intent: null, piOptions: [] },
        { createWorkspace: async () => { workspaceCreations += 1; } },
      );
    } catch (error) {
      errors.push(error);
    }
  }

  expect({ workspaceCreations, errorCodes: errors.map((error) => error.code) }).toEqual({
    workspaceCreations: 0,
    errorCodes: rejectedTargets.map(() => "USAGE_ERROR"),
  });
});

test("rejects normalization-sensitive concise paths before acquisition", async () => {
  let workspaceCreations = 0;
  const rejectedTargets = [
    "gh:acme//app/pull/42",
    "gh:acme/app//pull/42",
    "gh:acme/app/./pull/42",
    "gh:acme/app/section/../pull/42",
    "gh:acme\\app/pull/42",
    "gh:acme/app/tree/feature//cli",
    "gh:acme/app/tree/feature/%2e%2e/cli",
    "gh:acme/app/tree/feature\\cli",
  ];

  for (const target of rejectedTargets) {
    await expect(runReviewChange(
      { target, intent: null, piOptions: [] },
      { createWorkspace: async () => { workspaceCreations += 1; } },
    )).rejects.toMatchObject({ code: "USAGE_ERROR" });
  }

  expect(workspaceCreations).toBe(0);
});

test("rejects remote trust without an explicit GitHub acquisition", async () => {
  let workspaceCreations = 0;

  await expect(runReviewChange(
    { target: "feature/local", intent: null, piOptions: [], trustRemote: true },
    {
      cwd: "/repo",
      isGitRepository: async () => true,
      createWorkspace: async () => { workspaceCreations += 1; },
    },
  )).rejects.toThrow("--trust-remote requires an explicit GitHub target");

  expect(workspaceCreations).toBe(0);
});

test("rejects a sandbox request before acquisition when the parent cannot verify it", async () => {
  let workspaceCreations = 0;

  await expect(runReviewChange(
    { target: "gh:acme/app/pull/42", intent: null, piOptions: [], sandbox: true },
    {
      environment: {},
      createWorkspace: async () => { workspaceCreations += 1; },
      verifySandbox: async () => false,
    },
  )).rejects.toThrow("--sandbox requires the documented sandbox environment");

  expect(workspaceCreations).toBe(0);
});

test("does not accept an internal sandbox value as general trust", async () => {
  let materializations = 0;

  await runReviewChange(
    {
      target: "gh:acme/app/pull/42",
      intent: null,
      piOptions: [],
      sandboxVerified: true,
    },
    {
      environment: {},
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
      createWorkspace: async () => ({
        cwd: "/outside/no-checkout",
        sourceRoot: "/outside/no-checkout",
        cleanup: async () => {},
        materializeHead: async () => { materializations += 1; },
      }),
      resolveAcquiredTarget: async () => ({
        kind: "pull-request",
        target: "https://github.com/acme/app/pull/42",
        immutableRange: `${"a".repeat(40)}...${"b".repeat(40)}`,
        selectedHeadOid: "b".repeat(40),
        headRepository: { owner: "external", repository: "fork" },
      }),
      classifyTrust: async ({ sandboxVerified }) => ({
        trusted: sandboxVerified === true,
        reason: sandboxVerified === true ? "sandbox" : "untrusted",
      }),
      createReportDirectory: async () => "/reports/session",
      openReport: async () => "/reports/session/review-change.html",
      spawnProcess: async () => 0,
    },
  );

  expect(materializations).toBe(0);
});

test("materializes the exact OID only after the parent verifies the documented sandbox", async () => {
  const selectedHeadOid = "d".repeat(40);
  const lifecycle: string[] = [];

  await runReviewChange(
    { target: "gh:acme/app/pull/42", intent: null, piOptions: [], sandbox: true },
    {
      environment: {},
      verifySandbox: async () => { lifecycle.push("verify-sandbox"); return true; },
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
      createWorkspace: async () => {
        lifecycle.push("acquire:no-checkout");
        const workspace = {
          cwd: "/sandbox/no-checkout",
          sourceRoot: "/sandbox/no-checkout",
          cleanup: async () => {},
          materializeHead: async (oid) => {
            lifecycle.push(`materialize:${oid}`);
            return { ...workspace, cwd: `/sandbox/materialized-${oid}` };
          },
        };
        return workspace;
      },
      resolveAcquiredTarget: async () => ({
        kind: "pull-request",
        target: "https://github.com/acme/app/pull/42",
        immutableRange: `${"a".repeat(40)}...${selectedHeadOid}`,
        selectedHeadOid,
        headRepository: { owner: "external", repository: "fork" },
      }),
      createReportDirectory: async () => "/reports/session",
      openReport: async () => "/reports/session/review-change.html",
      spawnProcess: async () => { lifecycle.push("review"); return 0; },
    },
  );

  expect(lifecycle).toEqual([
    "verify-sandbox",
    "acquire:no-checkout",
    `materialize:${selectedHeadOid}`,
    "review",
  ]);
});

test("acquires the repository named by an explicit pull-request target outside Git", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-change-direct-pr-"));
  const outsideRepository = path.join(root, "outside-repository");
  const reviewRoot = path.join(root, "reviews");
  let requestedAcquisition: { owner: string; repository: string } | null = null;
  await mkdir(outsideRepository);

  try {
    const exitCode = await runReviewChange(
      { target: "https://github.com/acme/app/pull/42", intent: null, piOptions: [] },
      {
        environment: {},
        cwd: outsideRepository,
        status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {} },
        createWorkspace: (workspaceOptions) => createReviewWorkspace(
          { ...workspaceOptions, reviewRoot },
          {
            acquireGitHubRepository: async ({ owner, repository }) => {
              requestedAcquisition = { owner, repository };
              return { pushDisabled: true };
            },
          },
        ),
        resolveAcquiredTarget: async () => ({
          kind: "pull-request",
          target: "https://github.com/acme/app/pull/42",
          immutableRange: `${"a".repeat(40)}...${"b".repeat(40)}`,
          selectedHeadOid: "b".repeat(40),
          headRepository: { owner: "contributor", repository: "app" },
        }),
        classifyTrust: async () => ({ trusted: false, reason: "untrusted" }),
        createReportDirectory: async () => path.join(root, "report"),
        openReport: async () => path.join(root, "report", "review-change.html"),
        spawnProcess: async () => 0,
      },
    );

    expect({ exitCode, requestedAcquisition }).toEqual({
      exitCode: 0,
      requestedAcquisition: { owner: "acme", repository: "app" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("classifies every direct GitHub path before exact trusted materialization", async () => {
  const cases = [
    { name: "trusted-pr", target: "gh:acme/app/pull/42", trusted: true, kind: "pull-request" },
    { name: "untrusted-pr", target: "gh:acme/app/pull/42", trusted: false, kind: "pull-request" },
    { name: "trusted-branch", target: "gh:acme/app/tree/feature/cli", trusted: true, kind: "remote-branch" },
    { name: "untrusted-branch", target: "gh:acme/app/tree/feature/cli", trusted: false, kind: "remote-branch" },
  ];

  for (const reviewCase of cases) {
    const selectedHeadOid = reviewCase.name.startsWith("trusted") ? "a".repeat(40) : "b".repeat(40);
    const lifecycle: string[] = [];
    let reviewDirectory = "";
    let prompt = "";
    await runReviewChange(
      { target: reviewCase.target, intent: null, piOptions: [] },
      {
        environment: {},
        cwd: "/outside",
        status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
        resolveTarget: async () => ({
          kind: reviewCase.kind === "pull-request" ? "pull-request" : "github-branch",
          target: reviewCase.target,
        }),
        createWorkspace: async () => {
          lifecycle.push("acquire:no-checkout");
          const workspace = {
            cwd: "/isolated/no-checkout",
            sourceRoot: "/isolated/no-checkout",
            details: {
              remote: true,
              ...(reviewCase.kind === "remote-branch" ? {
                branchContentBinding: {
                  providerRepositoryId: "R_kgDODirect",
                  canonicalRepository: { owner: "contributor", repository: "app" },
                  defaultBranch: { name: "main", oid: "0".repeat(40) },
                  selectedBranch: { name: "feature/cli", oid: selectedHeadOid },
                },
              } : {}),
            },
            cleanup: async () => lifecycle.push(
              reviewCase.trusted ? `/isolated/materialized-${selectedHeadOid}` : "/isolated/no-checkout",
            ),
            materializeHead: async (oid) => {
              lifecycle.push(`materialize:${oid}`);
              return { ...workspace, cwd: `/isolated/materialized-${oid}` };
            },
          };
          return workspace;
        },
        resolveAcquiredTarget: async () => {
          lifecycle.push(`resolve:${selectedHeadOid}`);
          return {
            kind: reviewCase.kind,
            target: reviewCase.target,
            immutableRange: `${"0".repeat(40)}...${selectedHeadOid}`,
            selectedHeadOid,
            ...(reviewCase.kind === "remote-branch" ? { providerRepositoryId: "R_kgDODirect" } : {}),
            headRepository: { owner: "contributor", repository: "app" },
          };
        },
        classifyTrust: async () => {
          lifecycle.push(`classify:${reviewCase.trusted}`);
          return { trusted: reviewCase.trusted, reason: reviewCase.trusted ? "explicit" : "untrusted" };
        },
        createReportDirectory: async () => "/reports/session",
        openReport: async () => "/reports/session/review-change.html",
        spawnProcess: async (_command, args, options) => {
          lifecycle.push("review");
          reviewDirectory = options.cwd;
          prompt = args.at(-1);
          return 0;
        },
      },
    );

    expect({ lifecycle, reviewDirectory, prompt }).toEqual({
      lifecycle: [
        "acquire:no-checkout",
        `resolve:${selectedHeadOid}`,
        `classify:${reviewCase.trusted}`,
        ...(reviewCase.trusted ? [`materialize:${selectedHeadOid}`] : []),
        "review",
        reviewCase.trusted ? `/isolated/materialized-${selectedHeadOid}` : "/isolated/no-checkout",
      ],
      reviewDirectory: reviewCase.trusted
        ? `/isolated/materialized-${selectedHeadOid}`
        : "/isolated/no-checkout",
      prompt: expect.stringContaining(`"selectedHeadOid":"${selectedHeadOid}"`),
    });
  }
});

test("treats shared-history name reuse as safe content equivalence before A5 exact-OID materialization", async () => {
  const selectedHeadOid = "f".repeat(40);
  const lifecycle: string[] = [];

  await runReviewChange(
    { target: "gh:former-owner/former-name/tree/feature/cli", intent: null, piOptions: [] },
    {
      environment: {},
      cwd: "/outside",
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
      resolveTarget: async () => ({
        kind: "github-branch",
        target: "https://github.com/former-owner/former-name/tree/feature/cli",
      }),
      createWorkspace: async ({ githubTarget }) => {
        lifecycle.push(`acquire:${githubTarget.owner}/${githubTarget.repository}`);
        const workspace = {
          cwd: "/isolated/no-checkout",
          sourceRoot: "/isolated/no-checkout",
          details: {
            branchContentBinding: {
              providerRepositoryId: "R_kgDOCanonical",
              canonicalRepository: { owner: "Summit-Partners", repository: "News-Service" },
              defaultBranch: { name: "main", oid: "a".repeat(40) },
              selectedBranch: { name: "feature/cli", oid: selectedHeadOid },
            },
          },
          cleanup: async () => lifecycle.push("cleanup"),
          materializeHead: async (oid, ...extraArguments) => {
            lifecycle.push(`materialize:${oid}:extra=${extraArguments.length}`);
            return { ...workspace, cwd: `/isolated/materialized-${oid}` };
          },
        };
        return workspace;
      },
      resolveAcquiredTarget: async () => ({
        kind: "remote-branch",
        target: `${"a".repeat(40)}...${selectedHeadOid}`,
        immutableRange: `${"a".repeat(40)}...${selectedHeadOid}`,
        selectedHeadOid,
        providerRepositoryId: "R_kgDOCanonical",
        headRepository: { owner: "Summit-Partners", repository: "News-Service" },
      }),
      classifyTrust: async ({ headRepository }) => {
        lifecycle.push(`classify:${headRepository.owner}/${headRepository.repository}`);
        return { trusted: true, reason: "a5" };
      },
      createReportDirectory: async () => "/reports/session",
      openReport: async () => "/reports/session/review-change.html",
      spawnProcess: async () => { lifecycle.push("review"); return 0; },
    },
  );

  expect(lifecycle).toEqual([
    "acquire:former-owner/former-name",
    "classify:Summit-Partners/News-Service",
    `materialize:${selectedHeadOid}:extra=0`,
    "review",
    "cleanup",
  ]);
});

test("rejects a branch scope that differs from verified content before A5 classification or materialization", async () => {
  const lifecycle: string[] = [];

  await expect(runReviewChange(
    { target: "gh:acme/app/tree/feature", intent: null, piOptions: [] },
    {
      environment: {},
      cwd: "/outside",
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
      resolveTarget: async () => ({ kind: "github-branch", target: "branch" }),
      createWorkspace: async () => ({
        cwd: "/isolated/no-checkout",
        sourceRoot: "/isolated/no-checkout",
        details: {
          branchContentBinding: {
            providerRepositoryId: "R_kgDOAcquired",
            canonicalRepository: { owner: "acme", repository: "app" },
            defaultBranch: { name: "main", oid: "a".repeat(40) },
            selectedBranch: { name: "feature", oid: "b".repeat(40) },
          },
        },
        cleanup: async () => { lifecycle.push("cleanup"); },
        materializeHead: async () => { lifecycle.push("materialize"); },
      }),
      resolveAcquiredTarget: async () => ({
        kind: "remote-branch",
        target: `${"a".repeat(40)}...${"b".repeat(40)}`,
        immutableRange: `${"a".repeat(40)}...${"b".repeat(40)}`,
        selectedHeadOid: "b".repeat(40),
        providerRepositoryId: "R_kgDOReplacement",
        headRepository: { owner: "summit-partners", repository: "app" },
      }),
      classifyTrust: async () => {
        lifecycle.push("classify");
        return { trusted: true, reason: "a5" };
      },
      createReportDirectory: async () => "/reports/session",
      spawnProcess: async () => { lifecycle.push("review"); return 0; },
    },
  )).rejects.toThrow("not derived from verified provider and clone content");

  expect(lifecycle).toEqual(["cleanup"]);
});

test("promotes every source-discovered pull request into the direct parent lifecycle", async () => {
  const cases = [
    { target: "59", trusted: true },
    { target: "pull/59", trusted: false },
    { target: null, trusted: true },
  ];

  for (const reviewCase of cases) {
    const selectedHeadOid = "c".repeat(40);
    const lifecycle: string[] = [];
    let prompt = "";
    await runReviewChange(
      { target: reviewCase.target, intent: null, piOptions: [] },
      {
        environment: {},
        cwd: "/source",
        isGitRepository: async () => true,
        status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
        resolveTarget: async ({ cwd, target }) => {
          lifecycle.push(`discover:${cwd}:${target ?? "targetless"}`);
          return { kind: "pull-request", target: "https://github.com/acme/app/pull/59" };
        },
        createWorkspace: async ({ githubTarget, fetchRemote }) => {
          lifecycle.push(`acquire:${githubTarget?.owner}/${githubTarget?.repository}:fetch=${fetchRemote}`);
          const workspace = {
            cwd: "/remote/no-checkout",
            sourceRoot: "/remote/no-checkout",
            cleanup: async () => { lifecycle.push("cleanup:recorded"); },
            materializeHead: async (oid) => {
              lifecycle.push(`materialize:${oid}`);
              return { ...workspace, cwd: `/remote/materialized-${oid}` };
            },
          };
          return workspace;
        },
        resolveAcquiredTarget: async ({ cwd, githubTarget }) => {
          lifecycle.push(`freeze:${cwd}:pull/${githubTarget.number}`);
          return {
            kind: "pull-request",
            target: "https://github.com/acme/app/pull/59",
            immutableRange: `${"a".repeat(40)}...${selectedHeadOid}`,
            selectedHeadOid,
            headRepository: { owner: "contributor", repository: "fork" },
          };
        },
        classifyTrust: async ({ headRepository }) => {
          lifecycle.push(`classify:${headRepository.owner}/${headRepository.repository}`);
          return { trusted: reviewCase.trusted, reason: reviewCase.trusted ? "a5" : "untrusted" };
        },
        createReportDirectory: async () => "/reports/session",
        openReport: async () => "/reports/session/review-change.html",
        spawnProcess: async (_command, args, options) => {
          lifecycle.push(`review:${options.cwd}`);
          prompt = args.at(-1);
          return 0;
        },
      },
    );

    const reviewDirectory = reviewCase.trusted
      ? `/remote/materialized-${selectedHeadOid}`
      : "/remote/no-checkout";
    expect({ lifecycle, prompt }).toEqual({
      lifecycle: [
        `discover:/source:${reviewCase.target ?? "targetless"}`,
        "acquire:acme/app:fetch=false",
        "freeze:/remote/no-checkout:pull/59",
        "classify:contributor/fork",
        ...(reviewCase.trusted ? [`materialize:${selectedHeadOid}`] : []),
        `review:${reviewDirectory}`,
        "cleanup:recorded",
      ],
      prompt: expect.stringContaining(`"selectedHeadOid":"${selectedHeadOid}"`),
    });
  }
});

test("freezes an explicit GitHub branch after direct acquisition", async () => {
  const resolvedDirectories: string[] = [];
  let piArguments: string[] = [];

  await runReviewChange(
    { target: "gh:acme/app/tree/feature/cli", intent: null, piOptions: [] },
    {
      environment: {},
      cwd: "/outside",
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {} },
      resolveTarget: async ({ cwd }) => {
        resolvedDirectories.push(cwd);
        return { kind: "github-branch", target: "https://github.com/acme/app/tree/feature/cli" };
      },
      createWorkspace: async () => ({
        cwd: "/isolated",
        sourceRoot: "/isolated",
        details: {
          branchContentBinding: {
            providerRepositoryId: "R_kgDOBranch",
            canonicalRepository: { owner: "acme", repository: "app" },
            defaultBranch: { name: "main", oid: "0".repeat(40) },
            selectedBranch: { name: "feature/cli", oid: "a".repeat(40) },
          },
        },
        cleanup: async () => {},
      }),
      resolveAcquiredTarget: async ({ cwd }) => {
        resolvedDirectories.push(cwd);
        return {
          kind: "remote-branch",
          target: `${"0".repeat(40)}...${"a".repeat(40)}`,
          immutableRange: `${"0".repeat(40)}...${"a".repeat(40)}`,
          selectedHeadOid: "a".repeat(40),
          providerRepositoryId: "R_kgDOBranch",
          headRepository: { owner: "acme", repository: "app" },
        };
      },
      classifyTrust: async () => ({ trusted: false, reason: "untrusted" }),
      createReportDirectory: async () => "/reports/session",
      openReport: async () => "/reports/session/review-change.html",
      spawnProcess: async (_command, args) => {
        piArguments = args;
        return 0;
      },
    },
  );

  expect(resolvedDirectories).toEqual(["/outside", "/isolated"]);
  expect(piArguments.join(" ")).toContain(`${"0".repeat(40)}...${"a".repeat(40)}`);
});

test("rejects a selected-head symlink parent before child evidence or external writes and cleans isolation", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-change-symlink-parent-"));
  const source = path.join(root, "source");
  const reviewRoot = path.join(root, "reviews");
  const external = path.join(root, "external");
  let childEvidenceRuns = 0;
  let workspacePath = "";

  try {
    await Promise.all([git(["init", "-b", "feature", source]), mkdir(external)]);
    await git(["-C", source, "config", "user.name", "Test User"]);
    await git(["-C", source, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "tracked.txt"), "source\n");
    await git(["-C", source, "add", "tracked.txt"]);
    await git(["-C", source, "commit", "-m", "source"]);
    const sourceHead = (await git(["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await symlink(external, path.join(source, "notes"));
    await git(["-C", source, "add", "notes"]);
    await git(["-C", source, "commit", "-m", "selected symlink"]);
    const selectedHeadOid = (await git(["-C", source, "rev-parse", "HEAD"])).stdout.trim();
    await git(["-C", source, "reset", "--hard", sourceHead]);
    await mkdir(path.join(source, "notes"));
    await writeFile(path.join(source, "notes", "review.txt"), "captured\n");
    await git(["-C", source, "remote", "add", "origin", pathToFileURL(source).href]);

    await expect(runReviewChange(
      { target: "feature", intent: null, piOptions: [] },
      {
        environment: {},
        cwd: source,
        isGitRepository: async () => true,
        status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
        resolveTarget: async ({ cwd }) => cwd === source
          ? { kind: "local-branch", target: "feature" }
          : {
              kind: "local-range",
              target: `${sourceHead}...${selectedHeadOid}`,
              immutableRange: `${sourceHead}...${selectedHeadOid}`,
              selectedHeadOid,
            },
        createWorkspace: async (options) => {
          const workspace = await createReviewWorkspace({ ...options, reviewRoot });
          workspacePath = workspace.cwd;
          return workspace;
        },
        createReportDirectory: async () => path.join(root, "report"),
        spawnProcess: async () => { childEvidenceRuns += 1; return 0; },
        openReport: async () => path.join(root, "report", "review-change.html"),
      },
    )).rejects.toThrow("destination ancestor is a symbolic link");

    expect({
      childEvidenceRuns,
      sourceContent: await readFile(path.join(source, "notes", "review.txt"), "utf8"),
      externalChildExists: await stat(path.join(external, "review.txt")).then(() => true, () => false),
      workspaceExists: await stat(workspacePath).then(() => true, () => false),
    }).toEqual({
      childEvidenceRuns: 0,
      sourceContent: "captured\n",
      externalChildExists: false,
      workspaceExists: false,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fetches and materializes the exact accepted origin descendant before review", async () => {
  const lifecycle: string[] = [];
  const selectedHeadOid = "b".repeat(40);
  let piArguments: string[] = [];

  await runReviewChange(
    { target: "origin/feature/cli", intent: null, piOptions: [] },
    {
      environment: {},
      cwd: "/repo",
      isGitRepository: async () => true,
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {} },
      resolveTarget: async ({ cwd }) => {
        lifecycle.push(`resolve:${cwd}`);
        return cwd === "/repo"
          ? { kind: "local-branch", target: "origin/feature/cli" }
          : {
              kind: "local-range",
              target: `base...${selectedHeadOid}`,
              selectedHeadOid,
            };
      },
      createWorkspace: async ({ fetchRemote }) => {
        lifecycle.push(`workspace:fetch=${fetchRemote}`);
        return {
          cwd: "/isolated",
          sourceRoot: "/repo",
          cleanup: async () => {},
          materializeHead: async (oid) => {
            lifecycle.push(`materialize:${oid}`);
            return { cwd: "/isolated", sourceRoot: "/repo", cleanup: async () => {} };
          },
        };
      },
      createReportDirectory: async () => "/reports/session",
      openReport: async () => "/reports/session/review-change.html",
      spawnProcess: async (_command, args) => {
        lifecycle.push("review");
        piArguments = args;
        return 0;
      },
    },
  );

  expect({ lifecycle, prompt: piArguments.at(-1) }).toEqual({
    lifecycle: [
      "resolve:/repo",
      "workspace:fetch=true",
      "resolve:/isolated",
      `materialize:${selectedHeadOid}`,
      "review",
    ],
    prompt: expect.stringContaining(`base...${selectedHeadOid}`),
  });
});

test("materializes the exact selected local descendant before child evidence", async () => {
  const selectedHeadOid = "e".repeat(40);
  const lifecycle: string[] = [];
  let reviewPrompt = "";

  await runReviewChange(
    { target: "feature/cli", intent: null, piOptions: [] },
    {
      environment: {},
      cwd: "/repo",
      isGitRepository: async () => true,
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
      resolveTarget: async ({ cwd }) => cwd === "/repo"
        ? { kind: "local-branch", target: "feature/cli" }
        : {
            kind: "local-range",
            target: `${"a".repeat(40)}...${selectedHeadOid}`,
            immutableRange: `${"a".repeat(40)}...${selectedHeadOid}`,
            selectedHeadOid,
          },
      createWorkspace: async () => {
        const workspace = {
          cwd: "/isolated/source-head",
          sourceRoot: "/repo",
          details: { materializationState: "source-snapshot" },
          cleanup: async () => lifecycle.push("cleanup"),
          materializeHead: async (oid) => {
            lifecycle.push(`materialize:${oid}`);
            return {
              ...workspace,
              cwd: `/isolated/selected-${oid}`,
              details: {
                ...workspace.details,
                selectedHeadOid: oid,
                materializationState: "selected-head-replayed",
              },
            };
          },
        };
        return workspace;
      },
      createReportDirectory: async () => "/reports/session",
      openReport: async () => "/reports/session/review-change.html",
      spawnProcess: async (_command, args, options) => {
        lifecycle.push(`review:${options.cwd}`);
        reviewPrompt = args.at(-1);
        return 0;
      },
    },
  );

  expect({ lifecycle, reviewPrompt }).toEqual({
    lifecycle: [
      `materialize:${selectedHeadOid}`,
      `review:/isolated/selected-${selectedHeadOid}`,
      "cleanup",
    ],
    reviewPrompt: expect.stringContaining('"materializationState":"selected-head-replayed"'),
  });
});

test("cleans local isolation and skips evidence when snapshot replay conflicts", async () => {
  let cleanupRan = false;
  let reviewStarted = false;

  await expect(runReviewChange(
    { target: "feature/cli", intent: null, piOptions: [] },
    {
      environment: {},
      cwd: "/repo",
      isGitRepository: async () => true,
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
      resolveTarget: async ({ cwd }) => cwd === "/repo"
        ? { kind: "local-branch", target: "feature/cli" }
        : {
            kind: "local-range",
            target: `${"a".repeat(40)}...${"b".repeat(40)}`,
            selectedHeadOid: "b".repeat(40),
          },
      createWorkspace: async () => ({
        cwd: "/isolated/source-head",
        sourceRoot: "/repo",
        cleanup: async () => { cleanupRan = true; },
        materializeHead: async () => {
          throw new Error("Could not replay the source working snapshot onto the selected local head");
        },
      }),
      createReportDirectory: async () => "/reports/session",
      spawnProcess: async () => { reviewStarted = true; return 0; },
    },
  )).rejects.toThrow("Could not replay the source working snapshot");

  expect({ cleanupRan, reviewStarted }).toEqual({ cleanupRan: true, reviewStarted: false });
});

test("reports a missing origin branch after isolated fetch without launching review", async () => {
  let cleanupRan = false;
  let reviewStarted = false;

  await expect(runReviewChange(
    { target: "origin/missing", intent: null, piOptions: [] },
    {
      environment: {},
      cwd: "/repo",
      isGitRepository: async () => true,
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {} },
      resolveTarget: async ({ cwd }) => {
        if (cwd === "/repo") return { kind: "local-branch", target: "origin/missing" };
        throw new Error("Branch target not found: origin/missing");
      },
      createWorkspace: async () => ({
        cwd: "/isolated",
        sourceRoot: "/repo",
        cleanup: async () => { cleanupRan = true; },
      }),
      createReportDirectory: async () => "/reports/session",
      spawnProcess: async () => {
        reviewStarted = true;
        return 0;
      },
    },
  )).rejects.toThrow("Branch target not found: origin/missing");

  expect({ cleanupRan, reviewStarted }).toEqual({ cleanupRan: true, reviewStarted: false });
});

test("resolves a local branch against the fetched repository default branch", async () => {
  const resolutions: Array<{
    cwd: string;
    deferBranchFreshness: boolean | undefined;
    materializeSelectedHead: boolean | undefined;
  }> = [];
  const selectedHeadOid = "f".repeat(40);
  let fetchRemote: boolean | undefined;
  let piArguments: string[] = [];

  await runReviewChange(
    { target: "feature/cli", intent: null, piOptions: [] },
    {
      environment: {},
      status: {
        start() {},
        begin() {},
        succeed() {},
        fail() {},
        finish() {},
      },
      cwd: "/repo",
      isGitRepository: async () => true,
      resolveTarget: async ({ cwd, deferBranchFreshness, materializeSelectedHead }) => {
        resolutions.push({ cwd, deferBranchFreshness, materializeSelectedHead });
        return cwd === "/repo"
          ? { kind: "local-branch", target: "feature/cli" }
          : {
              kind: "local-range",
              target: `fetched-default...${selectedHeadOid}`,
              selectedHeadOid,
            };
      },
      createWorkspace: async (workspaceOptions) => {
        fetchRemote = workspaceOptions.fetchRemote;
        const workspace = {
          cwd: "/isolated",
          sourceRoot: "/repo",
          cleanup: async () => {},
          materializeHead: async () => workspace,
        };
        return workspace;
      },
      createReportDirectory: async () => "/reports/session",
      openReport: async () => "/reports/session/review-change.html",
      spawnProcess: async (_command, args) => {
        piArguments = args;
        return 0;
      },
    },
  );

  expect({ resolutions, fetchRemote }).toEqual({
    resolutions: [
      { cwd: "/repo", deferBranchFreshness: true, materializeSelectedHead: undefined },
      { cwd: "/isolated", deferBranchFreshness: undefined, materializeSelectedHead: true },
    ],
    fetchRemote: true,
  });
  expect(piArguments.join(" ")).toContain(`fetched-default...${selectedHeadOid}`);
});

test("keeps an explicit Git range frozen without local rematerialization", async () => {
  const resolutions: Array<{ cwd: string; target: string }> = [];
  let materializations = 0;
  let piArguments: string[] = [];

  await runReviewChange(
    { target: "upstream/main...HEAD", intent: null, piOptions: [] },
    {
      environment: {},
      cwd: "/repo",
      isGitRepository: async () => true,
      status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {} },
      resolveTarget: async ({ cwd, target }) => {
        resolutions.push({ cwd, target });
        return { kind: "local-range", target: cwd === "/repo" ? "frozen-base...frozen-head" : "changed-base...changed-head" };
      },
      createWorkspace: async () => ({
        cwd: "/isolated",
        sourceRoot: "/repo",
        cleanup: async () => {},
        materializeHead: async () => { materializations += 1; },
      }),
      createReportDirectory: async () => "/reports/session",
      openReport: async () => "/reports/session/review-change.html",
      spawnProcess: async (_command, args) => {
        piArguments = args;
        return 0;
      },
    },
  );

  expect({ resolutions, materializations, prompt: piArguments.at(-1) }).toEqual({
    resolutions: [{ cwd: "/repo", target: "upstream/main...HEAD" }],
    materializations: 0,
    prompt: expect.stringContaining("frozen-base...frozen-head"),
  });
});

test("reviews a frozen explicit range when origin is unavailable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "review-change-frozen-range-"));
  const repository = path.join(root, "repository");
  const reviewRoot = path.join(root, "reviews");
  await git(["init", "-b", "main", repository]);
  await git(["-C", repository, "config", "user.name", "Test User"]);
  await git(["-C", repository, "config", "user.email", "test@example.invalid"]);
  await writeFile(path.join(repository, "file.txt"), "main\n");
  await git(["-C", repository, "add", "file.txt"]);
  await git(["-C", repository, "commit", "-m", "main"]);
  await git(["-C", repository, "switch", "-c", "feature/frozen"]);
  await writeFile(path.join(repository, "file.txt"), "feature\n");
  await git(["-C", repository, "commit", "-am", "feature"]);
  await git(["-C", repository, "remote", "add", "origin", pathToFileURL(path.join(root, "unavailable.git")).href]);

  try {
    const exitCode = await runReviewChange(
      { target: "main...HEAD", intent: null, piOptions: [] },
      {
        environment: {},
        cwd: repository,
        status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {} },
        createWorkspace: (options) => createReviewWorkspace({ ...options, reviewRoot }),
        createReportDirectory: async () => path.join(root, "report"),
        openReport: async () => path.join(root, "report", "review-change.html"),
        spawnProcess: async () => 0,
      },
    );

    expect(exitCode).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);

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
