import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Worktrees } from "../harnesses/worktree-client";

const session = "11111111-1111-4111-8111-111111111111";
const CLAUDE_HOOK_SCENARIO_GUARD_MS = 120_000;
test("Claude transitions retain conversation checks without locking or owning manual sessions", async () => {
  const { handleWorktreeHook } = await import("../harnesses/claude/worktree");
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-task-")));
  const root = join(home, "project");
  mkdirSync(root);
  const oldRoot = process.env.WT_ROOT;
  process.env.WT_ROOT = join(home, "trees");
  const wt = new Worktrees(resolve("tools/worktree/target/release/wt"));
  try {
    for (const args of [["init", "-b", "main"], ["config", "user.name", "Test User"],
      ["config", "user.email", "test@example.invalid"], ["commit", "--allow-empty", "-m", "initial"]]) {
      expect(Bun.spawnSync(["git", ...args], { cwd: root }).exitCode).toBe(0);
    }
    const task = wt.run(root, ["new", "feature", "--local", "--json"]).worktree;
    const hook = (event: string, cwd: string, id = session, extra = {}) => handleWorktreeHook({
      hook_event_name: event, cwd, session_id: id, ...extra }, wt, root);
    hook("PreToolUse", root, session, { tool_name: "EnterWorktree", tool_input: { path: task.path } });
    // The native host, not the hook, moves the current directory and retains the conversation ID.
    const entered = JSON.parse(hook("PostToolUse", task.path, session, { tool_name: "EnterWorktree" }));
    expect(entered.hookSpecificOutput.hookEventName).toBe("PostToolUse");
    expect(entered.hookSpecificOutput.additionalContext).toContain("[WT continuation v1]");
    expect(entered.hookSpecificOutput.additionalContext).toContain("no new authorization");
    for (const event of ["SessionStart", "PostToolUseFailure", "PreToolUse"]) {
      expect(hook(event, task.path, session, { tool_name: "Bash" })).toBe("");
    }
    expect(() => hook("PostToolUse", root, session, { tool_name: "EnterWorktree" })).toThrow("verified WT task");
    expect(wt.session(root, "inspect", "feature", "claude").conversation).toBe(session);
    expect(wt.run(root, ["enter", "feature", "--json"]).worktree.path).toBe(task.path);
    const other = "22222222-2222-4222-8222-222222222222";
    expect(() => hook("PreToolUse", root, other, { tool_name: "EnterWorktree", tool_input: { path: task.path } }))
      .toThrow(`/resume ${session}`);
    // A native /branch fork keeps history but has no saved task binding of its own.
    const exit = { tool_name: "ExitWorktree", tool_input: { action: "keep" } };
    hook("PreToolUse", task.path, other, exit);
    const forkLeft = hook("PostToolUse", root, other, exit);
    expect(forkLeft).toContain("[WT continuation v1]");
    expect(JSON.parse(forkLeft).hookSpecificOutput.additionalContext).toBe(entered.hookSpecificOutput.additionalContext);
    expect(wt.session(root, "inspect", "feature", "claude")).toMatchObject({ conversation: session, atPrimary: false });
    expect(wt.run(root, ["session", "locate", "--harness", "claude", "--conversation", other]).worktree).toBeNull();
    expect(() => hook("PostToolUse", task.path, other, exit)).toThrow("primary");
    expect(hook("PostToolUseFailure", root, other, exit)).toBe("");
    // Manual sessions are not claimed or rejected just because a task has a saved conversation.
    hook("PreToolUse", task.path, other, { tool_name: "Write" });
    hook("PreToolUse", task.path, session, { tool_name: "Write" });
    hook("PreToolUse", task.path, session, { tool_name: "Write" });
    expect(() => hook("PreToolUse", root, session, { tool_name: "Write" })).toThrow("working directory");
    for (const cwd of [task.path, root]) {
      writeFileSync(join(cwd, "notes.txt"), "retain changes");
      expect(() => hook("PreToolUse", task.path, session, { tool_name: "ExitWorktree", tool_input: { action: "keep" } }))
        .toThrow("changes");
      unlinkSync(join(cwd, "notes.txt"));
    }
    hook("PreToolUse", task.path, session, { tool_name: "ExitWorktree", tool_input: { action: "keep" } });
    // Only a verified native exit allows this saved conversation to use primary tools.
    const left = JSON.parse(hook("PostToolUse", root, session, { tool_name: "ExitWorktree", tool_input: { action: "keep" } }));
    expect(left.hookSpecificOutput.additionalContext).toBe(entered.hookSpecificOutput.additionalContext);
    hook("PreToolUse", root, session, { tool_name: "Bash" });
    expect(wt.session(root, "inspect", "feature", "claude").conversation).toBe(session);
    hook("PreToolUse", root, session, { tool_name: "EnterWorktree", tool_input: { path: task.path } });
    hook("PostToolUse", task.path, session, { tool_name: "EnterWorktree" });
    hook("PreToolUse", task.path, session, { tool_name: "Write" });
    expect(() => hook("PreToolUse", root, session, { tool_name: "Write" })).toThrow("working directory");
    expect(() => hook("WorktreeRemove", task.path)).toThrow("wt clean");
    const listing = Bun.spawnSync(["git", "worktree", "list", "--porcelain"], { cwd: root }).stdout.toString();
    expect(listing).not.toMatch(/^locked/m);
    const damaged = wt.run(root, ["new", "damaged", "--local", "--json"]).worktree;
    const record = Bun.spawnSync(["git", "rev-parse", "--path-format=absolute", "--git-path", "wt-session-claude.json"],
      { cwd: damaged.path });
    expect(record.exitCode).toBe(0);
    writeFileSync(record.stdout.toString().trim(), "{interrupted reference");
    hook("PreToolUse", root, other, { tool_name: "Write" });
    hook("PreToolUse", task.path, session, { tool_name: "Write" });
    expect(() => wt.session(root, "inspect", "damaged", "claude")).toThrow("Invalid conversation binding");
  } finally {
    if (oldRoot === undefined) delete process.env.WT_ROOT; else process.env.WT_ROOT = oldRoot;
    rmSync(home, { recursive: true, force: true });
  }
}, CLAUDE_HOOK_SCENARIO_GUARD_MS);
