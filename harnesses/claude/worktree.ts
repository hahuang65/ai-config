import { realpathSync } from "node:fs";
import { packageWorktrees, requireClean, type Task, type Worktrees } from "../worktree-client.ts";

type Hook = { hook_event_name: string; cwd: string; session_id: string; agent_id?: string;
  tool_name?: string; tool_input?: { path?: string; name?: string; action?: string }; name?: string };

function locate(wt: Worktrees, origin: string, id: string): Task | undefined {
  return wt.run(origin, ["session", "locate", "--harness", "claude", "--conversation", id]).worktree ?? undefined;
}

function savedConversation(wt: Worktrees, origin: string, task: Task, id: string) {
  const saved = wt.session(origin, "inspect", task.task, "claude").conversation;
  if (saved && saved !== id) throw new Error(`This task has a saved Claude conversation. Run /resume ${saved}; do not carry the current conversation over it.`);
}

function verifySaved(event: Hook, wt: Worktrees, origin: string) {
  const expected = locate(wt, origin, event.session_id);
  if (!expected) return; // An ordinary/manual conversation is not a task-ownership request.
  const saved = wt.session(origin, "inspect", expected.task, "claude");
  const directory = saved.atPrimary ? saved.project.root : expected.path;
  if (realpathSync(event.cwd) !== directory) {
    throw new Error(`Claude's working directory is not its saved location: ${directory}. Resume the task before using tools.`);
  }
  wt.session(event.cwd, "verify", expected.task, "claude", event.session_id);
}

function selectedPath(wt: Worktrees, origin: string, path: string): Task {
  const canonical = realpathSync(path);
  const target = wt.run(origin, ["list", "--all", "--json"]).worktrees.find(t => t.managed && t.path === canonical);
  if (!target) throw new Error("EnterWorktree must select a verified WT task in this repository.");
  return target;
}

function beforeEntry(event: Hook, wt: Worktrees, origin: string) {
  requireClean(event.cwd);
  const current = locate(wt, origin, event.session_id);
  if (current) {
    const saved = wt.session(origin, "inspect", current.task, "claude");
    if (!saved.atPrimary || realpathSync(event.cwd) !== saved.project.root ||
        !event.tool_input?.path || realpathSync(event.tool_input.path) !== current.path) {
      throw new Error("Fork this task conversation with native /branch before starting another task; re-enter its saved task by path.");
    }
  }
  if (event.tool_input?.path) savedConversation(wt, origin, selectedPath(wt, origin, event.tool_input.path), event.session_id);
}

/** The native host switches conversations and cwd; no process claims or task locks are used. */
export function handleWorktreeHook(event: Hook, wt: Worktrees, origin = event.cwd): string {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(event.session_id) || !event.cwd) throw new Error("Missing Claude session identity or cwd.");
  if (event.hook_event_name === "WorktreeRemove") throw new Error("Worktrees are persistent. Use a separately authorized wt clean; native cleanup is disabled.");
  if (event.hook_event_name === "WorktreeCreate") {
    if (event.agent_id) throw new Error("Task conversations require the main Claude session, not a subagent.");
    beforeEntry(event, wt, origin);
    if (!event.name || !/^[a-z0-9][a-z0-9-]*$/.test(event.name)) throw new Error("Supply a WT task name.");
    return wt.run(event.cwd, ["new", event.name, "--json"]).worktree.path;
  }
  if (!wt.isRepository(origin)) return "";
  if (event.hook_event_name === "PreToolUse") {
    if (event.tool_name === "EnterWorktree") beforeEntry(event, wt, origin);
    else if (event.tool_name === "ExitWorktree") {
      if (event.tool_input?.action !== "keep") throw new Error("Use ExitWorktree with action keep. Only explicit wt clean may remove a task.");
      verifySaved(event, wt, origin);
      requireClean(event.cwd);
      requireClean(wt.run(origin, ["list", "--all", "--json"]).project.root);
    } else verifySaved(event, wt, origin);
  } else if (event.hook_event_name === "PostToolUse") {
    if (event.tool_name === "EnterWorktree") {
      const target = selectedPath(wt, origin, event.cwd);
      wt.session(event.cwd, "bind", target.task, "claude", event.session_id);
      verifySaved(event, wt, origin);
    } else if (event.tool_name === "ExitWorktree") {
      if (event.tool_input?.action !== "keep") throw new Error("Only a native keep exit may record departure.");
      const task = locate(wt, origin, event.session_id);
      if (task) wt.session(event.cwd, "depart", task.task, "claude", event.session_id);
      verifySaved(event, wt, origin);
    }
  }
  return "";
}

if (import.meta.main) {
  try {
    const input = await Bun.stdin.text();
    if (input.length > 1024 * 1024) throw new Error("Hook input exceeds the task adapter limit.");
    const event = JSON.parse(input) as Hook;
    const output = handleWorktreeHook(event, packageWorktrees(import.meta.url), process.env.CLAUDE_PROJECT_DIR || event.cwd);
    if (output) console.log(output);
  } catch (error) {
    console.error(String(error));
    process.exitCode = 2;
  }
}
