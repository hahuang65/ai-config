import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export type AgentMemoryCaptureMode = "off" | "metadata" | "full";
export type AgentMemoryRecallMode = "off" | "explicit";
export type AgentMemoryConfigurationEnvironment = {
  AGENTMEMORY_CAPTURE?: string;
  AGENTMEMORY_EXCLUDED_TOOLS?: string;
  AGENTMEMORY_POLICY_PATH?: string;
  AGENTMEMORY_PROJECT_NAME?: string;
  AGENTMEMORY_RECALL?: string;
};

export type ResolvedMemoryPolicy = {
  capture: AgentMemoryCaptureMode;
  recall: AgentMemoryRecallMode;
  excludedTools: string[];
};

type JsonRecord = Record<string, unknown>;
type PolicyDependencies = {
  environment?: AgentMemoryConfigurationEnvironment;
  readFile?: (path: string) => string;
};
type ProjectDependencies = {
  environment?: AgentMemoryConfigurationEnvironment;
  git?: (args: string[], cwd: string) => string;
};

function parseCaptureMode(value?: string): AgentMemoryCaptureMode {
  return value === "off" || value === "metadata" || value === "full" ? value : "full";
}

function parseRecallMode(value?: string): AgentMemoryRecallMode {
  return value === "off" ? "off" : "explicit";
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value !== "string") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
}

function policyRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function readPolicyDocument(
  environment: AgentMemoryConfigurationEnvironment,
  readFile: (path: string) => string,
): JsonRecord {
  const policyPath = environment.AGENTMEMORY_POLICY_PATH?.trim()
    || path.join(homedir(), ".agentmemory", "capture-policy.json");
  try {
    return policyRecord(JSON.parse(readFile(policyPath)));
  } catch {
    return {};
  }
}

export function resolveMemoryPolicy(
  project: string,
  dependencies: PolicyDependencies = {},
): ResolvedMemoryPolicy {
  const environment = dependencies.environment ?? process.env;
  const document = readPolicyDocument(
    environment,
    dependencies.readFile ?? ((policyPath) => readFileSync(policyPath, "utf8")),
  );
  const defaults = policyRecord(document.default);
  const projects = policyRecord(document.projects);
  const projectPolicy = policyRecord(projects[project]);
  const configuredCapture = environment.AGENTMEMORY_CAPTURE
    ?? projectPolicy.capture
    ?? defaults.capture;
  const configuredRecall = environment.AGENTMEMORY_RECALL
    ?? projectPolicy.recall
    ?? defaults.recall;
  const configuredExclusions = environment.AGENTMEMORY_EXCLUDED_TOOLS
    ?? projectPolicy.excludedTools
    ?? defaults.excludedTools;
  return {
    capture: parseCaptureMode(typeof configuredCapture === "string" ? configuredCapture : undefined),
    recall: parseRecallMode(typeof configuredRecall === "string" ? configuredRecall : undefined),
    excludedTools: ["memory_*", ...parseList(configuredExclusions)],
  };
}

function defaultGit(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 500,
  }).trim();
}

function normalizedRemote(remote: string): string | undefined {
  const scpMatch = remote.match(/^git@([^:]+):(.+)$/);
  if (scpMatch) return `${scpMatch[1].toLowerCase()}/${scpMatch[2].replace(/\.git$/, "")}`;
  try {
    const parsed = new URL(remote);
    const repository = parsed.pathname.replace(/^\/+|\.git$/g, "");
    return repository ? `${parsed.hostname.toLowerCase()}/${repository}` : undefined;
  } catch {
    return undefined;
  }
}

export function resolveProjectIdentity(
  cwd: string,
  dependencies: ProjectDependencies = {},
): string {
  const environment = dependencies.environment ?? process.env;
  const explicit = environment.AGENTMEMORY_PROJECT_NAME?.trim();
  if (explicit) return explicit;
  const git = dependencies.git ?? defaultGit;
  try {
    const remote = normalizedRemote(git(["remote", "get-url", "origin"], cwd));
    if (remote) return remote;
  } catch {
    // A local repository does not need a remote.
  }
  let commonDirectory = cwd;
  try {
    commonDirectory = path.resolve(cwd, git(["rev-parse", "--git-common-dir"], cwd));
  } catch {
    // Use cwd for a directory outside Git.
  }
  const repositoryName = path.basename(commonDirectory.replace(/[/\\]\.git$/, "")) || "project";
  const digest = crypto.createHash("sha256").update(commonDirectory).digest("hex").slice(0, 12);
  return `local/${repositoryName}-${digest}`;
}
