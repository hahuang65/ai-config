// harnesses/pi/worktree.ts
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { existsSync, realpathSync as realpathSync2, unlinkSync } from "node:fs";

// harnesses/worktree-client.ts
import { execFileSync, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

class Worktrees {
  executable;
  constructor(executable) {
    this.executable = executable;
  }
  run(cwd, args) {
    let output;
    try {
      output = execFileSync(this.executable, args, {
        cwd,
        env: { ...process.env },
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 1024 * 1024,
        stdio: ["ignore", "pipe", "pipe"]
      });
    } catch (error) {
      const failure = error;
      let partial = {};
      try {
        partial = JSON.parse(failure.stdout || "{}");
      } catch {}
      if (partial?.protocolVersion === 1 && partial.cleanupIncomplete && partial.removed) {
        throw new Error(`Worktree removed; local branch retained: ${partial.branchReason || "inspect Git state before retrying"}`);
      }
      throw new Error(failure.stderr?.trim() || failure.message || "WT failed");
    }
    const reply = JSON.parse(output);
    if (reply.protocolVersion !== 1)
      throw new Error("Unsupported WT protocol; rebuild the package.");
    return reply;
  }
  isRepository(cwd) {
    const result = spawnSync("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 1e4 });
    if (result.error)
      throw result.error;
    return result.status === 0;
  }
  session(cwd, action, task, harness, conversation) {
    return this.run(cwd, [
      "session",
      action,
      task,
      "--harness",
      harness,
      ...conversation ? ["--conversation", conversation] : []
    ]);
  }
}
function packageWorktrees(moduleUrl) {
  const source = realpathSync(fileURLToPath(moduleUrl));
  return new Worktrees(resolve(dirname(source), "../../tools/worktree/target/release/wt"));
}
function requireClean(cwd) {
  const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd, encoding: "utf8", timeout: 1e4 });
  if (status.trim())
    throw new Error("The current checkout has changes. Leave them in place and ask before switching tasks.");
}

// harnesses/pi/worktree.ts
var wt = packageWorktrees(import.meta.url);
var taskNamePattern = "[A-Za-z0-9][A-Za-z0-9_-]{0,63}";
var conversation = (ctx) => {
  const file = ctx.sessionManager.getSessionFile();
  if (!file)
    throw new Error("Task transitions require a persistent Pi conversation.");
  return file;
};
function completeTransition(ctx, task) {
  if (realpathSync2(ctx.cwd) !== task.path || realpathSync2(ctx.sessionManager.getCwd()) !== task.path) {
    throw new Error("Pi did not enter the task working directory. No task tools may run.");
  }
  wt.session(ctx.cwd, "bind", task.task, "pi", conversation(ctx));
  wt.session(ctx.cwd, "verify", task.task, "pi", conversation(ctx));
}
function carry(ctx, target) {
  const source = conversation(ctx);
  if (!existsSync(source))
    throw new Error("Send a message first so Pi saves the conversation before creating a task.");
  const fork = SessionManager.forkFrom(source, target);
  const file = fork.getSessionFile();
  const leaf = ctx.sessionManager.getLeafId();
  if (leaf && fork.getLeafId() !== leaf) {
    const selected = fork.createBranchedSession(leaf);
    if (!selected)
      throw new Error("Could not carry Pi's selected conversation branch.");
    unlinkSync(file);
    return selected;
  }
  return file;
}
function worktree(pi) {
  let pending = false;
  pi.on("tool_call", async () => {
    if (pending)
      return { block: true, reason: "Submit the prepared /wt command or run /wt cancel before continuing." };
  });
  pi.registerCommand("wt", {
    description: "new TASK [--local], enter TASK, leave (carry to primary), clean TASK (leave before cleanup)",
    handler: async (args, ctx) => {
      pending = false;
      if (args.trim() === "cancel")
        return;
      if (args.trim() === "leave")
        await leave(ctx);
      else if (new RegExp(`^clean ${taskNamePattern}$`).test(args.trim()))
        await clean(args.trim().slice(6), ctx);
      else
        await transition(args, ctx);
    }
  });
  pi.registerTool({
    name: "worktree_transition",
    label: "Task worktree",
    description: "Prepare a native Pi worktree command. new carries, enter resumes, leave carries back to primary without cleanup, clean leaves before safely removing an integrated task. clean requires explicit cleanup or delivery authorization. Press Enter once; do not edit until the transition completes.",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("new"), Type.Literal("enter"), Type.Literal("leave"), Type.Literal("clean")]),
      task: Type.Optional(Type.String({ pattern: `^${taskNamePattern}$`, minLength: 1, maxLength: 64 }))
    }),
    async execute(_id, args, _signal, _update, ctx) {
      if (ctx.mode !== "tui" || !ctx.hasUI)
        throw new Error("Native transitions require interactive Pi.");
      if (ctx.ui.getEditorText().trim())
        throw new Error("The editor contains a draft. Preserve it; submit or clear it before transitioning.");
      if (args.action === "leave" ? args.task !== undefined : !args.task)
        throw new Error("leave takes no task; other actions require a task.");
      ctx.ui.setEditorText(`/wt ${args.action}${args.task ? ` ${args.task}` : ""}`);
      pending = true;
      return {
        content: [{ type: "text", text: "Press Enter to enter the task, or /wt cancel to stay here. No transition has happened yet." }],
        details: { pending: true },
        terminate: true
      };
    }
  });
}
async function clean(task, ctx) {
  if (ctx.mode !== "tui")
    throw new Error("Cleanup requires Pi's interactive command context.");
  await ctx.waitForIdle();
  wt.run(ctx.cwd, ["clean", task, "--check", "--json"]);
  await leave(ctx, (fresh) => {
    try {
      const result = wt.run(fresh.cwd, ["clean", task, "--json"]);
      if (!result.removed)
        throw new Error("WT did not remove the task.");
      fresh.ui.notify(`Removed ${task}. ${result.branchRemoved ? "Local branch deleted." : `Branch retained: ${result.branchReason}`}`, "info");
    } catch (error) {
      fresh.ui.notify(`Returned to primary; cleanup incomplete. Inspect wt list before retrying: ${String(error)}`, "error");
      throw error;
    }
  });
}
async function leave(ctx, after) {
  if (ctx.mode !== "tui")
    throw new Error("Task transitions require Pi's interactive command context.");
  await ctx.waitForIdle();
  const inventory = wt.run(ctx.cwd, ["list", "--all", "--json"]);
  const root = inventory.project.root;
  if (realpathSync2(ctx.cwd) === root) {
    after?.(ctx);
    ctx.ui.notify(`Primary directory: ${root}`, "info");
    return;
  }
  const task = inventory.worktrees.find((t) => t.managed && t.path === realpathSync2(ctx.cwd));
  if (!task)
    throw new Error("Leave requires the primary directory or a verified task root.");
  requireClean(ctx.cwd);
  requireClean(root);
  const branch = inventory.worktrees.find((t) => t.path === root)?.branch;
  const file = carry(ctx, root);
  const switched = await ctx.switchSession(file, { withSession: async (fresh) => {
    const current = wt.run(fresh.cwd, ["list", "--all", "--json"]);
    if (conversation(fresh) !== file || realpathSync2(fresh.cwd) !== root || realpathSync2(fresh.sessionManager.getCwd()) !== root || current.project.root !== root || current.worktrees.find((t) => t.path === root)?.branch !== branch) {
      throw new Error("Pi did not return to the verified primary checkout. Worktree retained; inspect the session before cleanup.");
    }
    fresh.ui.notify(`Primary directory: ${root}; conversation carried, task retained.`, "info");
    after?.(fresh);
  } });
  if (switched.cancelled)
    throw new Error("Native return cancelled. Worktree and branch retained; cleanup did not run.");
}
async function transition(args, ctx) {
  const match = new RegExp(`^(new|enter) (${taskNamePattern})( --local)?$`).exec(args.trim());
  if (!match || match[1] === "enter" && match[3])
    throw new Error("Usage: /wt new TASK [--local], /wt enter TASK, /wt leave, or /wt clean TASK");
  if (ctx.mode !== "tui")
    throw new Error("Task transitions require Pi's interactive command context.");
  await ctx.waitForIdle();
  requireClean(ctx.cwd);
  const [_, action, task, local] = match;
  if (action === "new" && !existsSync(conversation(ctx)))
    throw new Error("Save the current conversation before creating a task.");
  const selected = action === "new" ? wt.run(ctx.cwd, ["new", task, ...local ? ["--local"] : [], "--json"]) : wt.session(ctx.cwd, "inspect", task, "pi");
  const file = action === "new" ? carry(ctx, selected.worktree.path) : selected.conversation;
  if (!file || !existsSync(file))
    throw new Error("No saved Pi conversation is available. Start Pi in the task checkout explicitly.");
  const manager = SessionManager.open(file);
  if (realpathSync2(manager.getCwd()) !== selected.worktree.path)
    throw new Error("Saved Pi conversation belongs to a different directory.");
  await ctx.switchSession(file, { withSession: async (fresh) => {
    if (conversation(fresh) !== file)
      throw new Error("Pi did not resume the selected task conversation.");
    completeTransition(fresh, selected.worktree);
    fresh.ui.notify(`Task ${task}: ${fresh.cwd}`, "info");
  } });
}
export {
  worktree as default
};
