import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("Treehouse skill delegates the installed CLI and native harness transitions", async () => {
  const skill = await source("skills/treehouse/SKILL.md");
  const workflow = await source("skills/treehouse/references/workflow.md");
  const content = `${skill}\n${workflow}`;

  expect(content).toContain("command -v treehouse");
  expect(content).toContain("~/.dotfiles/git/install.sh");
  expect(content).toContain("protocolVersion");
  expect(content).toContain("treehouse_transition");
  expect(content).toContain("prefills one authenticated internal command");
  expect(content).toContain("Press Enter once");
  expect(content).toContain("EnterWorktree({ path })");
  expect(content).toContain('ExitWorktree({ action: "keep" })');
  expect(content).toContain('--owner-pid "$PPID"');
  expect(content).toContain("--release-owner");
  expect(content).toContain("finalize the CLI-provided cleanup operation");
  expect(content).toContain("report its preserved path and stop");
  expect(content).not.toContain("process.chdir");
  expect(content).not.toContain("handoff file");
  expect(content).not.toContain("child agent");
});

test("build delegates isolation while preserving an explicit local-branch fallback", async () => {
  const build = await source("skills/build/SKILL.md");

  expect(build).toContain("existing linked worktree");
  expect(build).toContain("continue there without Treehouse adoption or relocation");
  expect(build).toContain("command -v treehouse");
  expect(build).toContain("load [../treehouse/SKILL.md]");
  expect(build).toContain("explicit approval");
  expect(build).toContain("ordinary local task branch");
  expect(build).toContain("Treehouse merge support will be unavailable");
  expect(build).toContain("Never offer the branch fallback after acquisition or native transition begins");
  expect(build).not.toContain("EnterWorktree");
  expect(build).not.toContain("switchSession");
  expect(build).not.toContain("process.chdir");
  expect(build).not.toContain("forkFrom");
  expect(build.match(/exactly \*\*four\*\* approval gates/g)).toHaveLength(1);
});

test("merge is a thin fail-closed alias for the Treehouse merge flow", async () => {
  const merge = await source("skills/merge/SKILL.md");

  expect(merge).toContain("$ARGUMENTS");
  expect(merge).toContain("../treehouse/references/workflow.md");
  expect(merge).toContain("managed task worktree");
  expect(merge).toContain("stop with Git dotfiles installation guidance");
  expect(merge).toContain("Never fall back to raw Git integration");
  expect(merge).not.toContain("git merge");
  expect(merge).not.toContain("git push");
});

test("commit remains checkout-local and never chains into Treehouse integration", async () => {
  const commit = await source("skills/commit/SKILL.md");

  expect(commit).toContain("one focused git commit");
  expect(commit).toContain("Never invoke Treehouse");
  expect(commit).toContain("Never change branches or worktree lifecycle");
  expect(commit).toContain("Never merge, rebase, or push");
  expect(commit).toContain("Integration is a separate explicit `/merge` action");
});

test("Claude permits Treehouse lifecycle and native transitions without broad Git bypasses", async () => {
  const settings = JSON.parse(await source("harnesses/claude/settings.json"));
  const allowed = settings.permissions.allow as string[];

  expect(allowed).toContain("Bash(command -v treehouse)");
  expect(allowed).toContain("Bash(treehouse)");
  expect(allowed).toContain("Bash(treehouse *)");
  expect(allowed).toContain("EnterWorktree");
  expect(allowed).toContain("ExitWorktree");
  expect(allowed).not.toContain("Bash(git *)");
});
