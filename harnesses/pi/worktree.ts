import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, realpathSync, unlinkSync } from "node:fs";
import { packageWorktrees, requireClean, type Task } from "../worktree-client.ts";

const wt = packageWorktrees(import.meta.url);
const taskNamePattern = "[A-Za-z0-9][A-Za-z0-9_-]{0,63}";
const conversation = (ctx: ExtensionContext) => {
  const file = ctx.sessionManager.getSessionFile();
  if (!file) throw new Error("Task transitions require a persistent Pi conversation.");
  return file;
};

function completeTransition(ctx: ExtensionContext, task: Task) {
  if (realpathSync(ctx.cwd) !== task.path || realpathSync(ctx.sessionManager.getCwd()) !== task.path) {
    throw new Error("Pi did not enter the task working directory. No task tools may run.");
  }
  wt.session(ctx.cwd, "bind", task.task, "pi", conversation(ctx));
  wt.session(ctx.cwd, "verify", task.task, "pi", conversation(ctx));
}

function carry(ctx: ExtensionContext, target: string): string {
  const source = conversation(ctx);
  if (!existsSync(source)) throw new Error("Send a message first so Pi saves the conversation before creating a task.");
  const fork = SessionManager.forkFrom(source, target);
  const file = fork.getSessionFile()!;
  const leaf = ctx.sessionManager.getLeafId();
  if (leaf && fork.getLeafId() !== leaf) {
    const selected = fork.createBranchedSession(leaf);
    if (!selected) throw new Error("Could not carry Pi's selected conversation branch.");
    unlinkSync(file); // Only the just-created intermediate fork; never a saved task conversation.
    return selected;
  }
  return file;
}

export default function worktree(pi: ExtensionAPI) {
  let pending = false;
  pi.on("tool_call", async () => {
    if (pending) return { block: true, reason: "Submit the prepared /wt command or run /wt cancel before continuing." };
  });
  pi.registerCommand("wt", {
    description: "new TASK [--local]: carry this conversation; enter TASK: resume its saved Pi conversation",
    handler: async (args, ctx) => {
      pending = false;
      if (args.trim() === "cancel") return;
      await transition(args, ctx);
    },
  });
  pi.registerTool({
    name: "worktree_transition",
    label: "Task worktree",
    description: "Prepare a native Pi task transition. New tasks carry this conversation; existing tasks resume their saved Pi conversation. The user presses Enter once. Do not edit until the transition completes.",
    parameters: Type.Object({ action: Type.Union([Type.Literal("new"), Type.Literal("enter")]),
      task: Type.String({ pattern: `^${taskNamePattern}$`, minLength: 1, maxLength: 64 }) }),
    async execute(_id, args, _signal, _update, ctx) {
      if (ctx.mode !== "tui" || !ctx.hasUI) throw new Error("Native transitions require interactive Pi.");
      if (ctx.ui.getEditorText().trim()) throw new Error("The editor contains a draft. Preserve it; submit or clear it before transitioning.");
      ctx.ui.setEditorText(`/wt ${args.action} ${args.task}`);
      pending = true;
      return { content: [{ type: "text", text: "Press Enter to enter the task, or /wt cancel to stay here. No transition has happened yet." }],
        details: { pending: true }, terminate: true };
    },
  });
}

async function transition(args: string, ctx: ExtensionCommandContext) {
  const match = new RegExp(`^(new|enter) (${taskNamePattern})( --local)?$`).exec(args.trim());
  if (!match || (match[1] === "enter" && match[3])) throw new Error("Usage: /wt new TASK [--local] or /wt enter TASK");
  if (ctx.mode !== "tui") throw new Error("Task transitions require Pi's interactive command context.");
  await ctx.waitForIdle();
  requireClean(ctx.cwd);
  const [_, action, task, local] = match;
  if (action === "new" && !existsSync(conversation(ctx))) throw new Error("Save the current conversation before creating a task.");
  const selected = action === "new"
    ? wt.run(ctx.cwd, ["new", task, ...(local ? ["--local"] : []), "--json"])
    : wt.session(ctx.cwd, "inspect", task, "pi");
  const file = action === "new" ? carry(ctx, selected.worktree.path) : selected.conversation;
  if (!file || !existsSync(file)) throw new Error("No saved Pi conversation is available. Start Pi in the task checkout explicitly.");
  const manager = SessionManager.open(file);
  if (realpathSync(manager.getCwd()) !== selected.worktree.path) throw new Error("Saved Pi conversation belongs to a different directory.");
  // Native replacement rebuilds destination tools and context; only then save the reference.
  await ctx.switchSession(file, { withSession: async fresh => {
    if (conversation(fresh) !== file) throw new Error("Pi did not resume the selected task conversation.");
    completeTransition(fresh, selected.worktree);
    fresh.ui.notify(`Task ${task}: ${fresh.cwd}`, "info");
  } });
}
