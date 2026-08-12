import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runReviewChange } from "../skills/review-change/runtime/runner.mjs";
import {
  acquireGitHubRepository,
  createReviewWorkspace,
} from "../skills/review-change/runtime/workspace.mjs";

const cleanupRoots: string[] = [];
const defaultOid = "a".repeat(40);
const selectedOid = "b".repeat(40);

function immutableRepositoryResponse({
  id = "R_kgDOImmutable",
  nameWithOwner = "Acme/Current-App",
  defaultBranchName = "main",
  defaultBranchOid = defaultOid,
  selectedBranchName = "feature/cli",
  selectedBranchOid = selectedOid,
} = {}) {
  return JSON.stringify({
    data: {
      node: {
        id,
        nameWithOwner,
        defaultBranchRef: defaultBranchName === null ? null : {
          name: defaultBranchName,
          target: { oid: defaultBranchOid },
        },
        selectedRef: selectedBranchName === null ? null : {
          name: selectedBranchName,
          target: { oid: selectedBranchOid },
        },
      },
    },
  });
}

function providerExecutor(response = immutableRepositoryResponse()) {
  const invocations: Array<{ command: string; args: string[]; cwd?: string }> = [];
  return {
    invocations,
    executeFile: async (command, args, options) => {
      invocations.push({ command, args, cwd: options.cwd });
      if (args[0] === "repo" && args[1] === "view") {
        return { stdout: JSON.stringify({ id: "R_kgDOImmutable", nameWithOwner: "Acme/Current-App" }) };
      }
      if (args[0] === "repo" && args[1] === "clone") return { stdout: "" };
      if (args[0] === "api" && args[1] === "graphql") return { stdout: response };
      throw new Error(`Unexpected provider invocation: ${command} ${args.join(" ")}`);
    },
  };
}

function acquiredGitExecutor({ branchOid = selectedOid, baseOid = defaultOid, missingRef = null } = {}) {
  const invocations: string[][] = [];
  return {
    invocations,
    executeGitFile: async (_command, args) => {
      invocations.push(args);
      const reference = args.at(-1);
      if (reference === "refs/remotes/origin/feature/cli^{commit}" && missingRef !== "branch") {
        return { stdout: `${branchOid}\n` };
      }
      if (reference === "refs/remotes/origin/main^{commit}" && missingRef !== "default") {
        return { stdout: `${baseOid}\n` };
      }
      throw Object.assign(new Error("missing acquired ref"), { code: 128 });
    },
  };
}

afterAll(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("direct GitHub acquisition content equivalence", () => {
  test("queries the immutable repository node and verifies selected and default objects", async () => {
    const provider = providerExecutor();
    const git = acquiredGitExecutor();
    const writes: string[][] = [];

    const acquisition = await acquireGitHubRepository(
      {
        owner: "former-owner",
        repository: "former-app",
        branch: "feature/cli",
        exactBranch: true,
        workspace: "/reviews/current-app",
      },
      {
        executeFile: provider.executeFile,
        executeGitFile: git.executeGitFile,
        runGit: async (args) => { writes.push(args); },
      },
    );

    const immutableLookup = provider.invocations.find(({ args }) => args[0] === "api");
    expect({
      acquisition,
      immutableLookup: immutableLookup && {
        command: immutableLookup.command,
        prefix: immutableLookup.args.slice(0, 2),
        idArgument: immutableLookup.args.includes("id=R_kgDOImmutable"),
        branchArgument: immutableLookup.args.includes("qualifiedName=refs/heads/feature/cli"),
        cwd: immutableLookup.cwd,
      },
      gitReads: git.invocations,
      writes,
    }).toEqual({
      acquisition: {
        pushDisabled: true,
        branchContentBinding: {
          providerRepositoryId: "R_kgDOImmutable",
          canonicalRepository: { owner: "Acme", repository: "Current-App" },
          defaultBranch: { name: "main", oid: defaultOid },
          selectedBranch: { name: "feature/cli", oid: selectedOid },
        },
      },
      immutableLookup: {
        command: "gh",
        prefix: ["api", "graphql"],
        idArgument: true,
        branchArgument: true,
        cwd: undefined,
      },
      gitReads: [
        ["-C", "/reviews/current-app", "rev-parse", "--verify", "refs/remotes/origin/main^{commit}"],
        ["-C", "/reviews/current-app", "rev-parse", "--verify", "refs/remotes/origin/feature/cli^{commit}"],
      ],
      writes: [["-C", "/reviews/current-app", "remote", "set-url", "--push", "origin", "no-push://review-change"]],
    });
  });

  test("accepts shared-history name reuse when selected and default content match", async () => {
    const provider = providerExecutor();
    const git = acquiredGitExecutor();

    const acquisition = await acquireGitHubRepository(
      {
        owner: "reused-owner",
        repository: "reused-name",
        branch: "feature/cli",
        exactBranch: true,
        workspace: "/reviews/transport-identity-unknown",
      },
      {
        executeFile: provider.executeFile,
        executeGitFile: git.executeGitFile,
        runGit: async () => {},
      },
    );

    expect(acquisition.branchContentBinding).toEqual({
      providerRepositoryId: "R_kgDOImmutable",
      canonicalRepository: { owner: "Acme", repository: "Current-App" },
      defaultBranch: { name: "main", oid: defaultOid },
      selectedBranch: { name: "feature/cli", oid: selectedOid },
    });
  });

  test("stops differing clone content before classification, materialization, or child evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-name-reuse-"));
    const reviewRoot = path.join(root, "reviews");
    const decoy = path.join(reviewRoot, "keep-this-path");
    const lifecycle: string[] = [];
    let recordedWorkspace = "";
    cleanupRoots.push(root);
    await mkdir(decoy, { recursive: true });
    const provider = providerExecutor();
    const git = acquiredGitExecutor({ branchOid: "c".repeat(40), baseOid: "d".repeat(40) });

    await expect(runReviewChange(
      { target: "gh:acme/app/tree/feature/cli", intent: null, piOptions: [] },
      {
        environment: {},
        cwd: "/outside",
        status: { start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {} },
        resolveTarget: async () => ({ kind: "github-branch", target: "branch" }),
        createWorkspace: (options) => createReviewWorkspace(
          { ...options, reviewRoot },
          {
            acquireGitHubRepository: async (acquisitionOptions) => {
              recordedWorkspace = acquisitionOptions.workspace;
              return acquireGitHubRepository(acquisitionOptions, {
                executeFile: provider.executeFile,
                executeGitFile: git.executeGitFile,
                runGit: async () => {},
              });
            },
          },
        ),
        classifyTrust: async () => { lifecycle.push("classify"); return { trusted: true, reason: "a5" }; },
        spawnProcess: async () => { lifecycle.push("review"); return 0; },
      },
    )).rejects.toThrow("branch content does not match provider metadata");

    expect({
      lifecycle,
      workspaceExists: await stat(recordedWorkspace).then(() => true, () => false),
      retainedPaths: await readdir(reviewRoot),
    }).toEqual({
      lifecycle: [],
      workspaceExists: false,
      retainedPaths: ["keep-this-path"],
    });
  });

  test("cleans exact acquisition when either acquired branch object is missing or mismatched", async () => {
    const cases = [
      { name: "selected mismatch", git: acquiredGitExecutor({ branchOid: "c".repeat(40) }), message: "selected branch content" },
      { name: "default mismatch", git: acquiredGitExecutor({ baseOid: "d".repeat(40) }), message: "default branch content" },
      { name: "selected missing", git: acquiredGitExecutor({ missingRef: "branch" }), message: "selected branch ref" },
      { name: "default missing", git: acquiredGitExecutor({ missingRef: "default" }), message: "default branch ref" },
    ];

    for (const reviewCase of cases) {
      const root = await mkdtemp(path.join(tmpdir(), "review-change-object-binding-"));
      const reviewRoot = path.join(root, "reviews");
      let materializations = 0;
      cleanupRoots.push(root);
      const provider = providerExecutor();

      await expect(createReviewWorkspace(
        {
          githubTarget: {
            kind: "branch",
            owner: "acme",
            repository: "app",
            branch: "feature/cli",
            exactBranch: true,
          },
          reviewRoot,
        },
        {
          acquireGitHubRepository: (options) => acquireGitHubRepository(options, {
            executeFile: provider.executeFile,
            executeGitFile: reviewCase.git.executeGitFile,
            runGit: async () => {},
          }),
          materializeGitHead: async () => { materializations += 1; },
        },
      )).rejects.toThrow(reviewCase.message);

      expect({
        name: reviewCase.name,
        materializations,
        retainedWorkspaces: await readdir(reviewRoot),
      }).toEqual({ name: reviewCase.name, materializations: 0, retainedWorkspaces: [] });
    }
  });
});
