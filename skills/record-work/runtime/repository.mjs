import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

function git(cwd, args, optional = false) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", optional ? "ignore" : "pipe"],
      timeout: 5_000,
    }).trim();
  } catch (error) {
    if (optional) return "";
    throw new Error("Work log capture requires a Git repository.", { cause: error });
  }
}

export function normalizeOrigin(rawOrigin) {
  const origin = rawOrigin.trim();
  if (!origin) return "";
  const scpMatch = origin.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  if (scpMatch && !origin.includes("://")) {
    return `${scpMatch[1].toLowerCase()}/${scpMatch[2].replace(/\.git$/, "").replace(/^\/+|\/+$/g, "")}`;
  }
  try {
    const parsed = new URL(origin);
    const repositoryPath = parsed.pathname.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
    if (!parsed.hostname || !repositoryPath) throw new Error("invalid origin");
    return `${parsed.hostname.toLowerCase()}/${repositoryPath}`;
  } catch {
    throw new Error("Git origin must be an SSH or URL repository location.");
  }
}

function mappingPath(store, commonDirectory) {
  const digest = crypto.createHash("sha256").update(commonDirectory).digest("hex");
  return path.join(store, "repositories", `${digest}.json`);
}

function createMapping(commonDirectory, origin) {
  const repositoryId = origin || `local:${crypto.createHash("sha256").update(commonDirectory).digest("hex")}`;
  return {
    schema_version: 1,
    repository_id: repositoryId,
    common_git_directory: commonDirectory,
    origins: origin ? [origin] : [],
  };
}

function persistMapping(mappingFile, mapping) {
  mkdirSync(path.dirname(mappingFile), { recursive: true, mode: 0o700 });
  const temporary = `${mappingFile}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(mapping, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, mappingFile);
}

function repositoryMapping(store, commonDirectory, origin) {
  const mappingFile = mappingPath(store, commonDirectory);
  const mapping = existsSync(mappingFile)
    ? JSON.parse(readFileSync(mappingFile, "utf8"))
    : createMapping(commonDirectory, origin);
  const origins = origin && !mapping.origins.includes(origin)
    ? [...mapping.origins, origin]
    : mapping.origins;
  const nextMapping = { ...mapping, origins };
  if (!existsSync(mappingFile) || origins !== mapping.origins) persistMapping(mappingFile, nextMapping);
  return nextMapping;
}

export function resolveRepository(cwd, store) {
  const root = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
  const rawCommonDirectory = git(root, ["rev-parse", "--git-common-dir"]);
  const commonDirectory = realpathSync(path.resolve(root, rawCommonDirectory));
  const origin = normalizeOrigin(git(root, ["remote", "get-url", "origin"], true));
  const mapping = repositoryMapping(store, commonDirectory, origin);
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true)
    || git(root, ["rev-parse", "--short", "HEAD"], true);
  return {
    id: mapping.repository_id,
    origin,
    root,
    branch,
  };
}
