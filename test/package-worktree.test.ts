import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { installedSdkFile } from "./fixtures/installed-pi-sdk";

test("the package owns both task adapters and all Claude lifecycle hooks", () => {
  const manifest = JSON.parse(readFileSync(resolve("manifest.json"), "utf8"));
  expect(manifest.links).toContainEqual({ destination: ".pi/agent/extensions/worktree.ts", target: "harnesses/pi/worktree.bundle.ts" });
  expect(manifest.links).toContainEqual({ destination: ".claude/hooks/worktree.ts", target: "harnesses/claude/worktree.ts" });
  const events = manifest.settings.filter(s => s.path[0] === "hooks" &&
    s.value.hooks?.some(h => h.command === "bun ~/.claude/hooks/worktree.ts")).map(s => s.path[1]);
  expect(events).toEqual(["PreToolUse", "PostToolUse", "WorktreeCreate", "WorktreeRemove"]);
});

export function project() {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "task-conversation-")));
  const cwd = join(home, "project");
  mkdirSync(cwd);
  const env = { ...process.env, HOME: home, WT_ROOT: join(home, "trees"),
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", PI_OFFLINE: "1",
    PI_CODING_AGENT_DIR: join(home, ".pi/agent") };
  for (const args of [["init", "-b", "main"], ["config", "user.name", "Test User"],
    ["config", "user.email", "test@example.invalid"], ["commit", "--allow-empty", "-m", "initial"]]) {
    const result = Bun.spawnSync(["git", ...args], { cwd, env });
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  }
  return { home, cwd, env };
}

test.each(["feature", "Task_123-xyz", `A${"_".repeat(63)}`])("native Pi carries and resumes task %s with destination tools", async (task) => {
  const p = project();
  try {
    const run = Bun.spawn(["node", resolve("test/fixtures/worktree-pi.mjs"), installedSdkFile(), p.cwd,
      resolve("harnesses/pi/worktree.bundle.ts"), task], { cwd: p.cwd, env: p.env, stdout: "pipe", stderr: "pipe" });
    const [output, errors, status] = await Promise.all([new Response(run.stdout).text(),
      new Response(run.stderr).text(), run.exited]);
    expect(status, errors).toBe(0);
    const result = JSON.parse(output);
    expect(result.carried).toBe(true);
    expect(result.resumed).toBe(true);
    expect(result.cwd).toBe(join(p.home, "trees/project", task));
    expect(result.toolCwd).toBe(result.cwd);
    expect(result.context).toContain("TASK_CONTEXT_MARKER");
  } finally { rmSync(p.home, { recursive: true, force: true }); }
}, 30_000);
