import { execFile } from "node:child_process";
import { promisify } from "node:util";

import {
  resolveGitHubRepositoryById,
  resolveGitHubRepositoryMetadata,
} from "./github-metadata.mjs";
import { parseSafeGitOutputRecord } from "../../shared/runtime/git-output-record.mjs";

const executeFile = promisify(execFile);
const OUTPUT_LIMIT = 50 * 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;
const ACQUISITION_TIMEOUT_MS = 60_000;
const noActivity = () => {};

export async function acquireGitHubRepository(
  { owner, repository, branch, exactBranch, workspace, signal, onActivity = noActivity },
  dependencies = {},
) {
  const execute = dependencies.executeFile ?? executeFile;
  const executeGit = dependencies.executeGitFile ?? executeFile;
  const run = dependencies.runGit ?? runGit;
  const requestedIdentity = `${owner}/${repository}`;
  const context = { signal, onActivity };
  const expectedRepository = await resolveGitHubRepositoryMetadata({
    requestedIdentity,
    context,
    executeProviderFile: execute,
  });
  onActivity("provider", `Acquire GitHub repository ${requestedIdentity} without checkout`);
  await execute("gh", ["repo", "clone", requestedIdentity, workspace, "--", "--no-checkout"], {
    encoding: "utf8",
    env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" },
    maxBuffer: OUTPUT_LIMIT,
    signal,
    timeout: ACQUISITION_TIMEOUT_MS,
  });
  const providerRepository = await resolveGitHubRepositoryById({
    repositoryId: expectedRepository.id,
    branchPath: branch,
    exactBranch: exactBranch === true,
    context,
    executeProviderFile: execute,
  });
  if (branch) {
    await verifyCloneBranchContent({ workspace, providerRepository, context, executeGit });
  }
  await run(["-C", workspace, "remote", "set-url", "--push", "origin", "no-push://review-change"], context);
  return branch
    ? { pushDisabled: true, branchContentBinding: branchContentBinding(providerRepository) }
    : { pushDisabled: true, providerRepository };
}

function branchContentBinding(providerRepository) {
  return {
    providerRepositoryId: providerRepository.id,
    canonicalRepository: {
      owner: providerRepository.owner,
      repository: providerRepository.repository,
    },
    defaultBranch: providerRepository.defaultBranch,
    selectedBranch: providerRepository.selectedBranch,
  };
}

async function verifyCloneBranchContent({ workspace, providerRepository, context, executeGit }) {
  const branchPairs = [
    ["default", providerRepository.defaultBranch],
    ["selected", providerRepository.selectedBranch],
  ];
  for (const [label, branch] of branchPairs) {
    const cloneOid = await readCloneBranchOid({ workspace, branch, label, context, executeGit });
    if (cloneOid !== branch.oid) {
      throw new Error(`The clone ${label} branch content does not match provider metadata`);
    }
  }
}

async function readCloneBranchOid({ workspace, branch, label, context, executeGit }) {
  const reference = `refs/remotes/origin/${branch.name}^{commit}`;
  context.onActivity("git", `git -C ${workspace} rev-parse --verify ${reference}`);
  try {
    const { stdout } = await executeGit("git", ["-C", workspace, "rev-parse", "--verify", reference], {
      encoding: "utf8", maxBuffer: OUTPUT_LIMIT, signal: context.signal, timeout: COMMAND_TIMEOUT_MS,
    });
    const oid = parseSafeGitOutputRecord(stdout);
    if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(oid ?? "")) return oid;
    throw new Error("malformed object ID");
  } catch (error) {
    throw new Error(`The acquired clone is missing its ${label} branch ref`, { cause: error });
  }
}

async function runGit(args, context) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  await executeFile("git", args, {
    maxBuffer: OUTPUT_LIMIT, signal: context.signal, timeout: COMMAND_TIMEOUT_MS,
  });
}
