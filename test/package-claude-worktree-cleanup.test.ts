import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const session = "11111111-1111-4111-8111-111111111111";
const executable = resolve("tools/worktree/target/release/wt");
const adapter = resolve("harnesses/claude/worktree.ts");

function trial() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-cleanup-")));
  const root = join(home, "project");
  mkdirSync(root);
  const env = { ...process.env, HOME: home, WT_ROOT: join(home, "trees"),
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };
  const run = (args: string[], cwd = root) => {
    const result = Bun.spawnSync(args, { cwd, env, timeout: 15_000 });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
    return result.stdout.toString();
  };
  for (const args of [["init", "-b", "main", "--template="], ["config", "user.name", "Test User"],
    ["config", "user.email", "test@example.invalid"], ["commit", "--allow-empty", "-m", "initial"]]) {
    run(["git", ...args]);
  }
  const hook = (origin: string, hook_event_name: string, cwd: string, extra = {}) => Bun.spawnSync([process.execPath, adapter], {
    cwd: root, env: { ...env, CLAUDE_PROJECT_DIR: origin }, timeout: 15_000,
    stdin: Buffer.from(JSON.stringify({ hook_event_name, cwd, session_id: session, ...extra })),
  });
  return { home, root, run, hook };
}

test("Claude tools still work after cleanup deletes the session's starting worktree", () => {
  const { home, root, run, hook: invoke } = trial();
  try {
    const task = JSON.parse(run([executable, "new", "feature", "--local", "--json"])).worktree;
    run([executable, "session", "bind", "feature", "--harness", "claude", "--conversation", session], task.path);
    const hook = (event: string, cwd: string, extra = {}) => invoke(task.path, event, cwd, extra);
    const exit = { tool_name: "ExitWorktree", tool_input: { action: "keep" } };
    const before = hook("PreToolUse", task.path, exit);
    expect(before.exitCode, before.stderr.toString()).toBe(0);
    const left = hook("PostToolUse", root, exit);
    expect(left.exitCode, left.stderr.toString()).toBe(0);
    expect(left.stdout.toString()).toContain("[WT continuation v1]");
    const saved = JSON.parse(run([executable, "session", "inspect", "feature", "--harness", "claude"]));
    expect(saved.atPrimary).toBe(true);
    const cleaned = JSON.parse(run([executable, "clean", "feature", "--json"]));
    expect(cleaned.removed).toBe(true);
    expect(cleaned.branchRemoved).toBe(true);
    expect(existsSync(task.path)).toBe(false);
    for (const event of ["SessionStart", "PreToolUse", "PostToolUseFailure"]) {
      const result = hook(event, root, { tool_name: "Read" });
      expect(result.exitCode, result.stderr.toString()).toBe(0);
      expect(result.stdout.toString()).toBe("");
      expect(existsSync(task.path)).toBe(false);
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 120_000);

test("Claude keeps private docs through native return and verified cleanup", () => {
  const { home, root, run, hook } = trial();
  try {
    const task = JSON.parse(run([executable, "new", "private-docs", "--local", "--json"])).worktree;
    run([executable, "session", "bind", "private-docs", "--harness", "claude", "--conversation", session], task.path);
    mkdirSync(join(root, ".git/info"), { recursive: true });
    writeFileSync(join(root, ".git/info/exclude"), "/docs/\n");
    for (const path of [task.path, root]) mkdirSync(join(path, "docs"));
    writeFileSync(join(task.path, "docs/untracked.md"), "private task notes\n");
    for (const path of [task.path, root]) writeFileSync(join(path, "docs/same.md"), "same notes\n");
    const exit = { tool_name: "ExitWorktree", tool_input: { action: "keep" } };
    const before = hook(task.path, "PreToolUse", task.path, exit);
    expect(before.exitCode, before.stderr.toString()).toBe(0);
    expect(existsSync(join(root, "docs/untracked.md"))).toBe(false);
    const left = hook(task.path, "PostToolUse", root, exit);
    expect(left.exitCode, left.stderr.toString()).toBe(0);
    expect(left.stdout.toString()).toContain("[WT continuation v1]");
    const cleaned = JSON.parse(run([executable, "clean", "private-docs", "--json"]));
    expect(cleaned).toMatchObject({ removed: true, branchRemoved: true, docsPreserved: 2 });
    expect(readFileSync(join(root, "docs/untracked.md"), "utf8")).toBe("private task notes\n");
    expect(readFileSync(join(root, "docs/same.md"), "utf8")).toBe("same notes\n");
    expect(existsSync(task.path)).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 120_000);

test("Claude return still blocks non-ignored untracked docs", () => {
  const { home, root, run, hook } = trial();
  try {
    const task = JSON.parse(run([executable, "new", "private-docs", "--local", "--json"])).worktree;
    run([executable, "session", "bind", "private-docs", "--harness", "claude", "--conversation", session], task.path);
    mkdirSync(join(task.path, "docs"));
    writeFileSync(join(task.path, "docs/private.md"), "task notes\n");
    const blocked = hook(task.path, "PreToolUse", task.path,
      { tool_name: "ExitWorktree", tool_input: { action: "keep" } });
    expect(blocked.exitCode).toBe(2);
    expect(blocked.stderr.toString()).toContain("changes");
    expect(existsSync(join(root, "docs"))).toBe(false);
    expect(readFileSync(join(task.path, "docs/private.md"), "utf8")).toBe("task notes\n");
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 120_000);

test("Claude origin recovery rejects invalid current directories and other origin errors", () => {
  const { home, root, hook } = trial();
  try {
    for (const [origin, cwd, error] of [
      [join(home, "removed-origin"), join(home, "removed-cwd"), "ENOENT"],
      [join(root, ".git/HEAD/child"), root, "ENOTDIR"],
    ]) {
      const result = hook(origin, "PreToolUse", cwd, { tool_name: "Read" });
      expect(result.exitCode).toBe(2);
      expect(result.stderr.toString()).toContain(error);
      expect(result.stdout.toString()).toBe("");
    }
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 120_000);

test("a missing starting directory does not bypass a saved Claude task location", () => {
  const { home, root, run, hook } = trial();
  try {
    const task = JSON.parse(run([executable, "new", "active", "--local", "--json"])).worktree;
    run([executable, "session", "bind", "active", "--harness", "claude", "--conversation", session], task.path);
    const origin = join(home, "removed-starting-directory");
    const blocked = hook(origin, "PreToolUse", root, { tool_name: "Read" });
    expect(blocked.exitCode).toBe(2);
    expect(blocked.stderr.toString()).toContain("working directory is not its saved location");
    expect(blocked.stdout.toString()).toBe("");
    const valid = hook(origin, "PreToolUse", task.path, { tool_name: "Read" });
    expect(valid.exitCode, valid.stderr.toString()).toBe(0);
    expect(valid.stdout.toString()).toBe("");
    const saved = JSON.parse(run([executable, "session", "inspect", "active", "--harness", "claude"]));
    expect(saved).toMatchObject({ conversation: session, atPrimary: false });
    const cleanup = hook(origin, "WorktreeRemove", root);
    expect(cleanup.exitCode).toBe(2);
    expect(cleanup.stderr.toString()).toContain("native cleanup is disabled");
    expect(existsSync(task.path)).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
}, 120_000);
