import { constants, openSync, closeSync, fstatSync, readSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep, basename } from "node:path";
import { createScopeChecker, humanRequests, needsScopeCheck, type Classifier } from "../../guard/semantic-scope";
import type { ToolCall } from "../../guard/guard-core";
import { initializeShellParser } from "../../guard/shell-parser";

const UNAVAILABLE = "Cannot establish semantic scope from bounded session evidence. Ask the user to clarify before retrying. No approval was inferred.";

function transcriptRequests(payload: any, home: string): string[] {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(payload.session_id) || typeof payload.transcript_path !== "string") throw Error(UNAVAILABLE);
  const configured = process.env.CLAUDE_CONFIG_DIR || resolve(home, ".claude");
  if (!isAbsolute(configured)) throw Error(UNAVAILABLE);
  const root = realpathSync(resolve(configured, "projects"));
  const path = realpathSync(payload.transcript_path);
  const local = relative(root, path);
  if (!local || local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local) || basename(path) !== `${payload.session_id}.jsonl`) throw Error(UNAVAILABLE);
  const fd = openSync(payload.transcript_path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw Error(UNAVAILABLE);
    const start = Math.max(0, stat.size - 262144);
    const bytes = Buffer.alloc(Math.min(stat.size, 262144));
    const size = readSync(fd, bytes, 0, bytes.length, start);
    const lines = bytes.subarray(0, size).toString("utf8").split("\n");
    if (start) lines.shift();
    const entries = lines.filter(line => line.trim()).map(line => JSON.parse(line))
      .filter(entry => !entry.sessionId || entry.sessionId === payload.session_id);
    const nodes = entries.filter(entry => typeof entry.uuid === "string" && ["user", "assistant"].includes(entry.type));
    const byId = new Map(nodes.map(entry => [entry.uuid, entry]));
    const branch: any[] = [];
    let leaf = nodes.at(-1);
    const seen = new Set<string>();
    while (leaf && !seen.has(leaf.uuid)) {
      seen.add(leaf.uuid);
      if (!leaf.isCompactSummary && !leaf.isMeta) branch.unshift({ type: "message", message: leaf.message });
      leaf = byId.get(leaf.parentUuid);
    }
    return humanRequests(branch);
  } finally { closeSync(fd); }
}

export async function evaluateSemanticScope(payload: any, classifier?: Classifier, home = homedir()) {
  const denied = (reason: string) => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
  try {
    if (!payload || typeof payload.tool_name !== "string" || !isAbsolute(payload.cwd || "")) return denied(UNAVAILABLE);
    const call: ToolCall = { tool: payload.tool_name.toLowerCase(), cwd: payload.cwd,
      command: payload.tool_input?.command, path: payload.tool_input?.file_path ?? payload.tool_input?.path };
    if (call.command) await initializeShellParser();
    if (!needsScopeCheck(call)) return null;
    const assess: Classifier = classifier ?? (async (request, signal) => {
      const { classifyNative } = await import("../pi/jev-bridge.mjs");
      const { workspaceSource } = await import("../../tools/project-pi.mjs");
      return classifyNative(request, signal, [workspaceSource(payload.cwd)]);
    });
    const check = createScopeChecker(assess);
    const reason = await check(call, () => transcriptRequests(payload, home));
    return reason ? denied(reason) : null;
  } catch { return denied(UNAVAILABLE); }
}
