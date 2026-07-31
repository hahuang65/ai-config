import { execFile, spawn } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readlink, realpath, rm, symlink } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { isPathWithin, resolveProspectivePath } from "./report-directory.mjs";

const executeFile = promisify(execFile);
const OUTPUT_LIMIT = 50 * 1024 * 1024;
const noActivity = () => {};

export async function createReviewWorkspace({ cwd, reviewRoot, signal, onActivity = noActivity } = {}) {
  const context = { signal, onActivity };
  const sourceRoot = await gitOutput(["-C", cwd ?? process.cwd(), "rev-parse", "--show-toplevel"], context);
  const sourceHead = await gitOutput(["-C", sourceRoot, "rev-parse", "HEAD"], context);
  const sourceBranch = await optionalGitOutput(["-C", sourceRoot, "symbolic-ref", "--short", "HEAD"], context);
  const root = reviewRoot ?? defaultReviewWorkspaceRoot();
  onActivity("path", `Validate review workspace root ${root} outside source checkout ${sourceRoot}`);
  const sourceRealPath = await realpath(sourceRoot);
  const prospectiveRoot = await resolveProspectivePath(path.resolve(root));
  if (!prospectiveRoot || isPathWithin(prospectiveRoot, sourceRealPath)) {
    throw new Error("The review workspace root must be outside the reviewed repository");
  }
  throwIfAborted(signal);
  await mkdir(root, { recursive: true });
  const prefix = `${safeName(path.basename(sourceRoot))}-change-review-cli-`;
  const workspace = await mkdtemp(path.join(await realpath(root), prefix));
  if (isPathWithin(await realpath(workspace), sourceRealPath)) {
    await rm(workspace, { recursive: true, force: true });
    throw new Error("The isolated clone resolved inside the reviewed repository");
  }
  try {
    const snapshot = await populateClone({ sourceRoot, sourceHead, sourceBranch, workspace }, context);
    onActivity("snapshot", `Snapshot ready: ${snapshot.patchBytes} patch bytes and ${snapshot.untrackedCount} untracked paths`);
    return {
      cwd: workspace,
      sourceRoot,
      details: { ...snapshot, pushDisabled: true },
      cleanup: () => rm(workspace, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(workspace, { recursive: true, force: true });
    throw error;
  }
}

async function populateClone({ sourceRoot, sourceHead, sourceBranch, workspace }, context) {
  await runGit(["clone", "--no-hardlinks", "--no-checkout", sourceRoot, workspace], context);
  await mirrorLocalBranches(sourceRoot, workspace, sourceBranch, context);
  await runGit(["-C", workspace, "checkout", sourceBranch || "--detach", ...(sourceBranch ? [] : [sourceHead])], context);
  await configureRemote(sourceRoot, workspace, context);
  const patch = await gitBuffer(["-C", sourceRoot, "diff", "--binary", "HEAD", "--"], context);
  if (patch.length > 0) await runGitWithInput(["-C", workspace, "apply", "--binary", "-"], patch, context);
  const untrackedCount = await copyUntrackedFiles(sourceRoot, workspace, context);
  return { patchBytes: patch.length, untrackedCount };
}

async function mirrorLocalBranches(sourceRoot, workspace, checkedOutBranch, context) {
  const refs = await gitOutput([
    "-C", sourceRoot, "for-each-ref", "--format=%(objectname) %(refname)", "refs/heads/",
  ], context);
  for (const line of refs.split("\n").filter(Boolean)) {
    throwIfAborted(context.signal);
    const [objectName, refName] = line.split(" ");
    if (refName === `refs/heads/${checkedOutBranch}`) continue;
    await runGit(["-C", workspace, "update-ref", refName, objectName], context);
  }
}

async function configureRemote(sourceRoot, workspace, context) {
  const remoteUrl = await optionalGitOutput(["-C", sourceRoot, "remote", "get-url", "origin"], context);
  await runGit([
    "-C", workspace, "remote", "set-url", "origin", safeRemoteUrl(remoteUrl) || "no-fetch://change-review",
  ], context);
  await runGit(["-C", workspace, "remote", "set-url", "--push", "origin", "no-push://change-review"], context);
  context.onActivity("guard", "Configured a credential-safe fetch URL and disabled the push URL");
}

async function copyUntrackedFiles(sourceRoot, workspace, context) {
  const output = await gitBuffer(["-C", sourceRoot, "ls-files", "--others", "--exclude-standard", "-z"], context);
  const relativePaths = output.toString("utf8").split("\0").filter(Boolean);
  for (const relativePath of relativePaths) {
    throwIfAborted(context.signal);
    const source = safeChildPath(sourceRoot, relativePath);
    const destination = safeChildPath(workspace, relativePath);
    const sourceStat = await lstat(source);
    await mkdir(path.dirname(destination), { recursive: true });
    if (sourceStat.isSymbolicLink()) await symlink(await readlink(source), destination);
    else if (sourceStat.isFile()) await copyFile(source, destination);
  }
  return relativePaths.length;
}

function safeChildPath(root, relativePath) {
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Git returned an unsafe path");
  return candidate;
}

async function gitOutput(args, context = {}) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  const { stdout } = await executeFile("git", args, {
    encoding: "utf8", maxBuffer: OUTPUT_LIMIT, signal: context.signal,
  });
  return stdout.trim();
}

async function optionalGitOutput(args, context) {
  try {
    return await gitOutput(args, context);
  } catch (error) {
    if (context.signal?.aborted) throw error;
    return null;
  }
}

async function gitBuffer(args, context) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  const { stdout } = await executeFile("git", args, {
    encoding: "buffer", maxBuffer: OUTPUT_LIMIT, signal: context.signal,
  });
  return stdout;
}

async function runGit(args, context) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  await executeFile("git", args, { maxBuffer: OUTPUT_LIMIT, signal: context.signal });
}

function runGitWithInput(args, input, context) {
  context.onActivity?.("git", `git ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { stdio: ["pipe", "ignore", "pipe"], signal: context.signal });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `git exited ${code}`)));
    child.stdin.end(input);
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw Object.assign(new Error("workspace creation interrupted"), { name: "AbortError" });
}

export function defaultReviewWorkspaceRoot(homeDirectory = homedir()) {
  return path.join(homeDirectory, ".review-treehouse");
}

export function safeRemoteUrl(remoteUrl) {
  if (!remoteUrl) return null;
  if (/^(?:git|https?|ssh):\/\//i.test(remoteUrl)) {
    try {
      const parsed = new URL(remoteUrl);
      if (parsed.search || parsed.hash) return null;
      parsed.username = parsed.protocol === "ssh:" && parsed.username === "git" ? "git" : "";
      parsed.password = "";
      return parsed.toString();
    } catch {
      return null;
    }
  }
  if (/[?#]/.test(remoteUrl)) return null;
  if (/^(?:git@)?[^/@:\s]+:[^\s]+$/.test(remoteUrl)) return remoteUrl;
  return null;
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}
