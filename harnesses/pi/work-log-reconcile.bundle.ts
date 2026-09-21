// @bun
// skills/record-work/runtime/reconciliation.mjs
import crypto from "crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import path from "path";
function statePath(directory, sessionId) {
  const digest = crypto.createHash("sha256").update(sessionId).digest("hex");
  return path.join(directory, "sessions", `${digest}.json`);
}
function readState(directory, sessionId) {
  const target = statePath(directory, sessionId);
  if (!existsSync(target))
    return { session_id: sessionId, pending: false, reminder_sent: false };
  return JSON.parse(readFileSync(target, "utf8"));
}
function writeState(directory, sessionId, state) {
  const target = statePath(directory, sessionId);
  mkdirSync(path.dirname(target), { recursive: true, mode: 448 });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}
`, { mode: 384, flag: "wx" });
  renameSync(temporary, target);
}
function isMeaningfulWorkLogMutation(toolName, input = {}) {
  const normalizedToolName = String(toolName ?? "").toLowerCase();
  if (["write", "edit"].includes(normalizedToolName))
    return true;
  if (normalizedToolName !== "bash")
    return false;
  const command = String(input?.command ?? "");
  if (/\bwork-log\b/.test(command))
    return false;
  return /(?:^|[;&|\n]\s*)git\s+(?:-[^\s]+\s+)*commit(?:\s|$)/.test(command);
}
function observeMeaningfulEvidence(directory, sessionId, repositoryId, now = new Date) {
  writeState(directory, sessionId, {
    session_id: sessionId,
    repository_id: repositoryId,
    pending: true,
    reminder_sent: false,
    observed_at: now.toISOString()
  });
}
function requestReconciliation(directory, sessionId) {
  const state = readState(directory, sessionId);
  if (!state.pending || state.reminder_sent)
    return;
  writeState(directory, sessionId, { ...state, reminder_sent: true });
  return "Record a Work log checkpoint before finishing.";
}

// skills/record-work/runtime/query.mjs
import { spawnSync } from "child_process";
import { existsSync as existsSync2, readdirSync } from "fs";
import path2 from "path";
import { fileURLToPath } from "url";
var SQL_PATH = fileURLToPath(new URL("../../summarize-work/references/work-log.sql", import.meta.url));
function containsCheckpoint(directory) {
  const root = path2.join(directory, "events");
  if (!existsSync2(root))
    return false;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith(".json"))
        return true;
      if (entry.isDirectory())
        pending.push(path2.join(current, entry.name));
    }
  }
  return false;
}
function queryWorkLog(directory, sql) {
  if (!containsCheckpoint(directory))
    return [];
  const invocation = spawnSync("duckdb", ["-json", "-init", SQL_PATH, "-c", sql], {
    encoding: "utf8",
    env: { ...process.env, WORK_LOG_DIR: directory },
    maxBuffer: 50 * 1024 * 1024,
    timeout: 1e4
  });
  if (invocation.error?.code === "ENOENT")
    throw new Error("DuckDB is required to query the Work log.");
  if (invocation.error?.code === "ETIMEDOUT")
    throw new Error("DuckDB query timed out after 10 seconds.");
  if (invocation.status !== 0)
    throw new Error(invocation.stderr.trim() || "DuckDB query failed.");
  try {
    return JSON.parse(invocation.stdout || "[]");
  } catch {
    throw new Error("DuckDB returned invalid JSON.");
  }
}
function openWork(directory, limit) {
  const limitClause = Number.isInteger(limit) ? `LIMIT ${limit}` : "";
  return queryWorkLog(directory, `
    SELECT work_item_id, title, state, summary, parent_work_item_id,
           repository_id, repository_origin, branch, due_at,
           created_at, updated_at, next_action, commits, tickets
    FROM work_log_items
    WHERE state IN ('planned', 'active', 'paused')
    ORDER BY work_item_id
    ${limitClause}
  `);
}

// skills/record-work/runtime/repository.mjs
import crypto2 from "crypto";
import { execFileSync } from "child_process";
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync2, renameSync as renameSync2, realpathSync, writeFileSync as writeFileSync2 } from "fs";
import path3 from "path";
function git(cwd, args, optional = false) {
  try {
    return execFileSync("git", ["-C", cwd, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", optional ? "ignore" : "pipe"],
      timeout: 5000
    }).trim();
  } catch (error) {
    if (optional)
      return "";
    throw new Error("Work log capture requires a Git repository.", { cause: error });
  }
}
function normalizeOrigin(rawOrigin) {
  const origin = rawOrigin.trim();
  if (!origin)
    return "";
  const scpMatch = origin.match(/^(?:[^@/]+@)?([^:/]+):(.+)$/);
  if (scpMatch && !origin.includes("://")) {
    return `${scpMatch[1].toLowerCase()}/${scpMatch[2].replace(/\.git$/, "").replace(/^\/+|\/+$/g, "")}`;
  }
  try {
    const parsed = new URL(origin);
    const repositoryPath = parsed.pathname.replace(/\.git$/, "").replace(/^\/+|\/+$/g, "");
    if (!parsed.hostname || !repositoryPath)
      throw new Error("invalid origin");
    return `${parsed.hostname.toLowerCase()}/${repositoryPath}`;
  } catch {
    throw new Error("Git origin must be an SSH or URL repository location.");
  }
}
function mappingPath(store, commonDirectory) {
  const digest = crypto2.createHash("sha256").update(commonDirectory).digest("hex");
  return path3.join(store, "repositories", `${digest}.json`);
}
function createMapping(commonDirectory, origin) {
  const repositoryId = origin || `local:${crypto2.createHash("sha256").update(commonDirectory).digest("hex")}`;
  return {
    schema_version: 1,
    repository_id: repositoryId,
    common_git_directory: commonDirectory,
    origins: origin ? [origin] : []
  };
}
function persistMapping(mappingFile, mapping) {
  mkdirSync2(path3.dirname(mappingFile), { recursive: true, mode: 448 });
  const temporary = `${mappingFile}.${process.pid}.tmp`;
  writeFileSync2(temporary, `${JSON.stringify(mapping, null, 2)}
`, { mode: 384, flag: "wx" });
  renameSync2(temporary, mappingFile);
}
function repositoryMapping(store, commonDirectory, origin) {
  const mappingFile = mappingPath(store, commonDirectory);
  const mapping = existsSync3(mappingFile) ? JSON.parse(readFileSync2(mappingFile, "utf8")) : createMapping(commonDirectory, origin);
  const origins = origin && !mapping.origins.includes(origin) ? [...mapping.origins, origin] : mapping.origins;
  const nextMapping = { ...mapping, origins };
  if (!existsSync3(mappingFile) || origins !== mapping.origins)
    persistMapping(mappingFile, nextMapping);
  return nextMapping;
}
function resolveRepository(cwd, store) {
  const root = realpathSync(git(cwd, ["rev-parse", "--show-toplevel"]));
  const rawCommonDirectory = git(root, ["rev-parse", "--git-common-dir"]);
  const commonDirectory = realpathSync(path3.resolve(root, rawCommonDirectory));
  const origin = normalizeOrigin(git(root, ["remote", "get-url", "origin"], true));
  const mapping = repositoryMapping(store, commonDirectory, origin);
  const branch = git(root, ["symbolic-ref", "--quiet", "--short", "HEAD"], true) || git(root, ["rev-parse", "--short", "HEAD"], true);
  return {
    id: mapping.repository_id,
    origin,
    root,
    branch
  };
}

// skills/record-work/runtime/storage.mjs
import { homedir } from "os";
import path4 from "path";
function resolveWorkLogDirectory(environment = process.env) {
  const configured = environment.WORK_LOG_DIR?.trim();
  const fallbackRoot = environment.XDG_DATA_HOME?.trim() || path4.join(homedir(), ".local", "share");
  const directory = configured || path4.join(fallbackRoot, "work-log");
  if (!path4.isAbsolute(directory))
    throw new Error("WORK_LOG_DIR must be an absolute path.");
  return path4.resolve(directory);
}

// skills/summarize-work/runtime/render.mjs
var MAX_DIGEST_TITLES = 10;
function digestLine(label, workItems) {
  const visible = workItems.slice(0, MAX_DIGEST_TITLES);
  const omitted = workItems.length - visible.length;
  const suffix = omitted > 0 ? `; ${omitted} more` : "";
  return `${label}: ${visible.map((workItem) => workItem.title).join("; ")}${suffix}`;
}
function renderSessionDigest(openWorkItems, repositoryId, now = new Date) {
  const repositoryWork = openWorkItems.filter((workItem) => workItem.repository_id === repositoryId);
  const active = repositoryWork.filter((workItem) => workItem.state === "active");
  const paused = repositoryWork.filter((workItem) => workItem.state === "paused");
  const due = repositoryWork.filter((workItem) => workItem.due_at && new Date(workItem.due_at).valueOf() <= now.valueOf());
  const dueIds = new Set(due.map((workItem) => workItem.work_item_id));
  const otherPlanned = repositoryWork.filter((workItem) => workItem.state === "planned" && !dueIds.has(workItem.work_item_id));
  const lines = [`Work log for ${repositoryId}:`];
  if (active.length > 0)
    lines.push(digestLine("Active", active));
  if (paused.length > 0)
    lines.push(digestLine("Paused", paused));
  if (due.length > 0)
    lines.push(digestLine("Due or overdue", due));
  lines.push(`Other planned work: ${otherPlanned.length}`);
  return `${lines.join(`
`)}
`;
}

// harnesses/pi/extensions/work-log-reconcile.ts
function sessionId(context) {
  const manager = context.sessionManager;
  return String(manager.getSessionId?.() ?? manager.getSessionFile?.() ?? "unknown");
}
function defaultDigest(context) {
  try {
    const directory = resolveWorkLogDirectory(process.env);
    const repository = resolveRepository(context.cwd, directory);
    return renderSessionDigest(openWork(directory, 1000), repository.id);
  } catch {
    return;
  }
}
function defaultObserve(event, context) {
  try {
    const directory = resolveWorkLogDirectory(process.env);
    const repository = resolveRepository(context.cwd, directory);
    observeMeaningfulEvidence(directory, sessionId(context), repository.id);
  } catch {}
}
function defaultReconcile(context) {
  try {
    return requestReconciliation(resolveWorkLogDirectory(process.env), sessionId(context));
  } catch {
    return;
  }
}
function registerWorkLogReconciliation(pi, dependencies = {}) {
  pi.on("session_start", async (_event, context) => {
    const digest = await (dependencies.digest ?? defaultDigest)(context);
    if (!digest)
      return;
    pi.sendMessage({
      customType: "work-log-digest",
      content: digest,
      display: true
    }, { deliverAs: "nextTurn" });
  });
  pi.on("tool_result", async (event, context) => {
    if (event.isError || !isMeaningfulWorkLogMutation(event.toolName, event.input))
      return;
    await (dependencies.observe ?? defaultObserve)(event, context);
  });
  pi.on("agent_settled", async (_event, context) => {
    const reason = await (dependencies.reconcile ?? defaultReconcile)(context);
    if (!reason)
      return;
    pi.sendMessage({
      customType: "work-log-reconciliation",
      content: reason,
      display: true
    }, { deliverAs: "followUp", triggerTurn: true });
  });
}
function workLogReconciliation(pi) {
  registerWorkLogReconciliation(pi);
}
export {
  registerWorkLogReconciliation,
  workLogReconciliation as default
};
