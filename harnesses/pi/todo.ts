import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { copy, empty, entryType, InvalidChecklistState, output, parameters, read, reply, valid } from "./checklist/state";
import { caption, clear, full, notify, show } from "./checklist/view";

function refresh(_event: unknown, ctx: ExtensionContext) {
  try { show(ctx, read(ctx)); }
  catch { clear(ctx); }
}

export default function checklist(pi: ExtensionAPI) {
  pi.registerTool({
    name: "todo", label: "Session checklist", exposure: "model-only", executionMode: "sequential",
    description: "Read or atomically replace the current task's short session checklist. " +
      "Use read to recover progress, or write with title and the complete items array. " +
      "Items have unique stable ids, short text, and pending/in_progress/completed status; at most one may be in progress. " +
      "Track meaningful steps only within the authorized task, not speculative tests or routine conversation. " +
      "This is not Worklog, a backlog, a scheduler, approval, or authority to implement, commit, install, deliver, or publish.",
    parameters, outputSchema: output, renderCall: caption,
    async execute(_id, input, signal, _update, ctx) {
      try {
        if (signal?.aborted) return reply(read(ctx), "cancelled");
        if (input.action === "read") {
          if (input.title !== undefined || input.items !== undefined) {
            return reply(read(ctx), "error", "Read does not accept title or items.");
          }
          return reply(read(ctx));
        }
        const next = { version: 1, title: input.title, items: input.items };
        if (!valid(next)) return reply(read(ctx), "error", "A write requires a bounded title and items array, unique ids, and at most one in-progress step.");
        pi.appendEntry(entryType, copy(next));
        show(ctx, next);
        return reply(next);
      } catch {
        return reply(empty(), "error", "Unable to read or confirm checklist persistence. Read before retrying.");
      }
    },
  });
  pi.registerCommand("todos", {
    description: "Show the current session checklist without changing it",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) return;
      try {
        const current = read(ctx);
        notify(ctx, () => full(current), "info");
      } catch (error) {
        const message = error instanceof InvalidChecklistState
          ? "The stored session checklist is invalid. Replace it explicitly to recover."
          : "The session checklist is unavailable. Try reading it again.";
        notify(ctx, () => message, "error");
      }
    },
  });
  pi.on("session_start", refresh);
  pi.on("session_tree", refresh);
  pi.on("session_compact", refresh);
  pi.on("session_shutdown", (_event, ctx) => clear(ctx));
}
