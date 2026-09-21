import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

function statePath(directory, sessionId) {
  const digest = crypto.createHash("sha256").update(sessionId).digest("hex");
  return path.join(directory, "sessions", `${digest}.json`);
}

function readState(directory, sessionId) {
  const target = statePath(directory, sessionId);
  if (!existsSync(target)) return { session_id: sessionId, pending: false, reminder_sent: false };
  return JSON.parse(readFileSync(target, "utf8"));
}

function writeState(directory, sessionId, state) {
  const target = statePath(directory, sessionId);
  mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  renameSync(temporary, target);
}

export function isMeaningfulWorkLogMutation(toolName, input = {}) {
  const normalizedToolName = String(toolName ?? "").toLowerCase();
  if (["write", "edit"].includes(normalizedToolName)) return true;
  if (normalizedToolName !== "bash") return false;
  const command = String(input?.command ?? "");
  if (/\bwork-log\b/.test(command)) return false;
  return /(?:^|[;&|\n]\s*)git\s+(?:-[^\s]+\s+)*commit(?:\s|$)/.test(command);
}

export function observeMeaningfulEvidence(directory, sessionId, repositoryId, now = new Date()) {
  writeState(directory, sessionId, {
    session_id: sessionId,
    repository_id: repositoryId,
    pending: true,
    reminder_sent: false,
    observed_at: now.toISOString(),
  });
}

export function clearReconciliation(directory, sessionId, checkpointId) {
  writeState(directory, sessionId, {
    session_id: sessionId,
    pending: false,
    reminder_sent: false,
    checkpoint_id: checkpointId,
  });
}

export function requestReconciliation(directory, sessionId) {
  const state = readState(directory, sessionId);
  if (!state.pending || state.reminder_sent) return undefined;
  writeState(directory, sessionId, { ...state, reminder_sent: true });
  return "Record a Work log checkpoint before finishing.";
}
