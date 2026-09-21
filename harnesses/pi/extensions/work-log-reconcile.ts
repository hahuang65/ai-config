import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import {
  isMeaningfulWorkLogMutation,
  observeMeaningfulEvidence,
  requestReconciliation,
} from "../../../skills/record-work/runtime/reconciliation.mjs";
import { openWork } from "../../../skills/record-work/runtime/query.mjs";
import { resolveRepository } from "../../../skills/record-work/runtime/repository.mjs";
import { resolveWorkLogDirectory } from "../../../skills/record-work/runtime/storage.mjs";
import { renderSessionDigest } from "../../../skills/summarize-work/runtime/render.mjs";

type ReconciliationDependencies = {
  digest?: (context: ExtensionContext) => Promise<string | undefined> | string | undefined;
  observe?: (event: any, context: ExtensionContext) => Promise<void> | void;
  reconcile?: (context: ExtensionContext) => Promise<string | undefined> | string | undefined;
};

function sessionId(context: ExtensionContext): string {
  const manager = context.sessionManager as any;
  return String(manager.getSessionId?.() ?? manager.getSessionFile?.() ?? "unknown");
}

function defaultDigest(context: ExtensionContext): string | undefined {
  try {
    const directory = resolveWorkLogDirectory(process.env);
    const repository = resolveRepository(context.cwd, directory);
    return renderSessionDigest(openWork(directory, 1_000), repository.id);
  } catch {
    return undefined;
  }
}

function defaultObserve(event: any, context: ExtensionContext): void {
  try {
    const directory = resolveWorkLogDirectory(process.env);
    const repository = resolveRepository(context.cwd, directory);
    observeMeaningfulEvidence(directory, sessionId(context), repository.id);
  } catch {
    // Work outside Git is allowed only without Work log capture.
  }
}

function defaultReconcile(context: ExtensionContext): string | undefined {
  try {
    return requestReconciliation(resolveWorkLogDirectory(process.env), sessionId(context));
  } catch {
    return undefined;
  }
}

export function registerWorkLogReconciliation(
  pi: ExtensionAPI,
  dependencies: ReconciliationDependencies = {},
): void {
  pi.on("session_start", async (_event, context) => {
    const digest = await (dependencies.digest ?? defaultDigest)(context);
    if (!digest) return;
    pi.sendMessage({
      customType: "work-log-digest",
      content: digest,
      display: true,
    }, { deliverAs: "nextTurn" });
  });

  pi.on("tool_result", async (event, context) => {
    if (event.isError || !isMeaningfulWorkLogMutation(event.toolName, event.input)) return;
    await (dependencies.observe ?? defaultObserve)(event, context);
  });

  pi.on("agent_settled", async (_event, context) => {
    const reason = await (dependencies.reconcile ?? defaultReconcile)(context);
    if (!reason) return;
    pi.sendMessage({
      customType: "work-log-reconciliation",
      content: reason,
      display: true,
    }, { deliverAs: "followUp", triggerTurn: true });
  });
}

export default function workLogReconciliation(pi: ExtensionAPI): void {
  registerWorkLogReconciliation(pi);
}
