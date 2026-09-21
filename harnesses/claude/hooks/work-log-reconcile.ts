#!/usr/bin/env bun

import {
  isMeaningfulWorkLogMutation,
  observeMeaningfulEvidence,
  requestReconciliation,
} from "../../../skills/record-work/runtime/reconciliation.mjs";
import { openWork } from "../../../skills/record-work/runtime/query.mjs";
import { resolveRepository } from "../../../skills/record-work/runtime/repository.mjs";
import { resolveWorkLogDirectory } from "../../../skills/record-work/runtime/storage.mjs";
import { renderSessionDigest } from "../../../skills/summarize-work/runtime/render.mjs";

type HookPayload = Record<string, any>;
type HookDependencies = {
  digest?: (payload: HookPayload) => string | undefined;
  observe?: (payload: HookPayload) => void;
  reconcile?: (payload: HookPayload) => string | undefined;
};

function sessionId(payload: HookPayload): string {
  return String(payload.session_id ?? payload.sessionId ?? "unknown");
}

function cwd(payload: HookPayload): string {
  return String(payload.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd());
}

function defaultDigest(payload: HookPayload): string | undefined {
  try {
    const directory = resolveWorkLogDirectory(process.env);
    const repository = resolveRepository(cwd(payload), directory);
    return renderSessionDigest(openWork(directory, 1_000), repository.id);
  } catch {
    return undefined;
  }
}

function defaultObserve(payload: HookPayload): void {
  try {
    const directory = resolveWorkLogDirectory(process.env);
    const repository = resolveRepository(cwd(payload), directory);
    observeMeaningfulEvidence(directory, sessionId(payload), repository.id);
  } catch {
    // Work outside Git is allowed only without Work log capture.
  }
}

function defaultReconcile(payload: HookPayload): string | undefined {
  try {
    return requestReconciliation(resolveWorkLogDirectory(process.env), sessionId(payload));
  } catch {
    return undefined;
  }
}

export async function handleClaudeWorkLogHook(
  payload: HookPayload,
  dependencies: HookDependencies = {},
): Promise<Record<string, any> | undefined> {
  const eventName = String(payload.hook_event_name ?? "");
  if (eventName === "SessionStart") {
    const digest = (dependencies.digest ?? defaultDigest)(payload);
    return digest ? {
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: digest,
      },
    } : undefined;
  }
  if (eventName === "PostToolUse" && isMeaningfulWorkLogMutation(payload.tool_name, payload.tool_input)) {
    (dependencies.observe ?? defaultObserve)(payload);
    return;
  }
  if (eventName !== "Stop") return;
  const reason = (dependencies.reconcile ?? defaultReconcile)(payload);
  return reason ? { decision: "block", reason } : undefined;
}

async function main(): Promise<void> {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  try {
    const payload = JSON.parse(input);
    const response = await handleClaudeWorkLogHook(payload);
    if (response) process.stdout.write(JSON.stringify(response));
  } catch {
    // Reconciliation is a safety net and must not block on malformed hook input.
  }
}

if (import.meta.main) void main();
