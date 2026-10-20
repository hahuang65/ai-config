import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COMMIT_LOG_COMMAND_COUNT, COMMIT_LOG_COMMAND_GUARD_MS, COMMIT_LOG_EARLIER_TASKS,
  COMMIT_LOG_SCENARIO_GUARD_MS } from "./fixtures/commit-log";

const skillPath = fileURLToPath(new URL("../skills/commit/SKILL.md", import.meta.url));
const rulePath = fileURLToPath(new URL("../rules/git-commit.md", import.meta.url));

test("the replacement commit skill uses its own rule and preserves explicit commit authority", () => {
  const skill = readFileSync(skillPath, "utf8");
  expect(skill).toContain("name: commit");
  expect(skill).toContain("global instruction symlink target");
  expect(skill).toContain("~/.gitmessage");
  expect(skill).toContain("worklog list --state open --all --json");
  expect(skill).toContain("worklog commit --task");
  expect(skill).toContain("only when the user explicitly requests");
  expect(skill).toContain("git diff --cached");
  expect(skill).not.toContain(".dotfiles/ai");
  expect(skill).not.toContain("pi-minimal");
});

test("the synthetic Worklog scenario budgets every bounded command and a cleanup margin", () => {
  expect(COMMIT_LOG_EARLIER_TASKS).toBe(20);
  expect(COMMIT_LOG_COMMAND_COUNT).toBe(25);
  expect(COMMIT_LOG_COMMAND_GUARD_MS).toBe(10_000);
  expect(COMMIT_LOG_SCENARIO_GUARD_MS).toBe(260_000);
  expect(COMMIT_LOG_SCENARIO_GUARD_MS - COMMIT_LOG_COMMAND_COUNT * COMMIT_LOG_COMMAND_GUARD_MS)
    .toBe(COMMIT_LOG_COMMAND_GUARD_MS);
});

test("the bundled Worklog records a synthetic commit using the commands named by the skill", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "native-commit-log-")));
  try {
    const project = join(home, "project");
    mkdirSync(project);
    const env = { HOME: home, PATH: process.env.PATH ?? "", GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null" };
    const binary = realpathSync(fileURLToPath(new URL("../tools/worklog/target/release/wl", import.meta.url)));
    let commands = 0;
    const run = (command: string, args: string[]) => {
      commands++;
      return spawnSync(command, args,
        { cwd: project, env, encoding: "utf8", timeout: COMMIT_LOG_COMMAND_GUARD_MS });
    };
    expect(run("git", ["init", "-q"]).status).toBe(0);
    for (let index = 0; index < COMMIT_LOG_EARLIER_TASKS; index++) {
      expect(run(binary, ["start", `Earlier task ${index}`, "--json"]).status).toBe(0);
    }
    const start = run(binary, ["start", "Synthetic task", "--json"]);
    expect(start.status).toBe(0);
    const id = JSON.parse(start.stdout).entry.task;
    const defaultList = run(binary, ["list", "--state", "open", "--json"]);
    expect(JSON.parse(defaultList.stdout).omitted).toBe(1);
    const list = run(binary, ["list", "--state", "open", "--all", "--json"]);
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout).items.some((task: { id: number }) => task.id === id)).toBe(true);
    const recorded = run(binary, ["commit", "--task", String(id), "--hash", "abcdef0",
      "--subject", "Synthetic change", "--json"]);
    expect(recorded.status).toBe(0);
    expect(JSON.parse(recorded.stdout).entry.commit.hash).toBe("abcdef0");
    expect(commands).toBe(COMMIT_LOG_COMMAND_COUNT);
  } finally { rmSync(home, { recursive: true, force: true }); }
}, COMMIT_LOG_SCENARIO_GUARD_MS);

test("the native Git rule retains A5 and parent-repository staging protections", () => {
  const rule = readFileSync(rulePath, "utf8");
  expect(rule).toContain("global or system Git configuration");
  expect(rule).toContain("Repository-local configuration cannot grant A5 status");
  for (const protectedPath of ["CONTEXT.md", "docs/adr/**", "docs/features/**", "domain-documentation.json"]) {
    expect(rule).toContain(protectedPath);
  }
  expect(rule).toContain("~/.dotfiles");
  expect(rule).toContain("~/.gitmessage");
  expect(rule).not.toContain("~/.dotfiles/ai");
});
