import { execFile } from "node:child_process";
import { promisify } from "node:util";

const executeFile = promisify(execFile);
const OUTPUT_LIMIT = 1024 * 1024;
const COMMAND_TIMEOUT_MS = 15_000;

export function hasVerifiedBranchContent(binding) {
  return Boolean(
    binding?.providerRepositoryId
    && binding.canonicalRepository?.owner
    && binding.canonicalRepository?.repository
    && binding.defaultBranch?.oid
    && binding.selectedBranch?.oid,
  );
}

export async function freezeContentBoundGitHubBranchRange(cwd, binding, context) {
  const base = await commitObject(cwd, binding.defaultBranch.oid, context);
  const head = await commitObject(cwd, binding.selectedBranch.oid, context);
  if (base !== binding.defaultBranch.oid || head !== binding.selectedBranch.oid) {
    throw new Error("The verified branch content changed before scope freezing");
  }
  const branchPoint = await gitOutput(cwd, ["merge-base", base, head], context);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(branchPoint)) {
    throw new Error("Git returned an invalid branch-point object ID");
  }
  context.onActivity("scope", `Frozen GitHub branch ${branchPoint}...${head}`);
  return `${branchPoint}...${head}`;
}

async function commitObject(cwd, reference, context) {
  return gitOutput(cwd, ["rev-parse", "--verify", `${reference}^{commit}`], context);
}

async function gitOutput(cwd, args, context) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  const { stdout } = await (context.executeGitFile ?? executeFile)("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: OUTPUT_LIMIT,
    signal: context.signal,
    timeout: COMMAND_TIMEOUT_MS,
  });
  return stdout.trim();
}
