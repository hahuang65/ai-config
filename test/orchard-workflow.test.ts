import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("harness baseline keeps ordinary work local and reserves Orchard for explicit isolation", async () => {
  const prompt = await source("harness-system-prompt.md");

  expect(prompt).toContain("Ordinary work defaults to the current checkout on a local task branch");
  expect(prompt).toContain("Do not invoke Orchard for an ordinary request");
  expect(prompt).toContain("Name branches `user-initials/short-intent`");
  expect(prompt).toContain("Use Orchard for `/build` and explicit lifecycle requests");
  expect(prompt).toContain("Pass Orchard the same concise `<short-intent>` used in the branch name");
  expect(prompt).not.toContain("short-description");
  expect(prompt).not.toContain("<project-basename>-<short-intent>");
  expect(prompt).not.toContain("~/.orchard/");
  expect(prompt).not.toContain("Review change isolation");
});

test("Orchard skill delegates the installed CLI and native harness transitions", async () => {
  const skill = await source("skills/orchard/SKILL.md");
  const workflow = await source("skills/orchard/references/workflow.md");
  const content = `${skill}\n${workflow}`;

  expect(content).toContain("command -v orchard");
  expect(content).toContain("~/.dotfiles/git/install.sh");
  expect(content).toContain("protocolVersion");
  expect(content).toContain("orchard_transition");
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
  expect(build).toContain("continue there without Orchard adoption or relocation");
  expect(build).toContain("command -v orchard");
  expect(build).toContain("load [../orchard/SKILL.md]");
  expect(build).toContain("explicit approval");
  expect(build).toContain("ordinary local task branch");
  expect(build).toContain("Orchard delivery support will be unavailable");
  expect(build).toContain("Never offer the branch fallback after acquisition or native transition begins");
  expect(build).not.toContain("EnterWorktree");
  expect(build).not.toContain("switchSession");
  expect(build).not.toContain("process.chdir");
  expect(build).not.toContain("forkFrom");
  expect(build.match(/exactly \*\*four\*\* approval gates/g)).toHaveLength(1);
});

test("deliver is a thin Orchard prompt with commit fallback", async () => {
  const delivery = await source("commands/deliver.md");
  const orchard = await source("skills/orchard/references/workflow.md");

  expect(delivery).toContain("`orchard` skill for its deliver operation");
  expect(delivery).toContain("`needs-commit`");
  expect(delivery).toContain("`commit` skill");
  expect(delivery).toContain("managed task or ordinary local branch");
  expect(delivery).toContain("exact checkout path and branch");
  expect(delivery).toContain("retry Orchard deliver");
  expect(delivery).not.toContain("A5 project");
  expect(delivery).not.toContain("git pr create --web --fill");
  expect(orchard).toContain("delivery policy");
  expect(orchard).toContain("--finalize-operation");
  expect(orchard).toContain("worktree intent");
  expect(orchard).toContain("ordinary local branch");
  expect(orchard).not.toContain("Orchard merge");
});

test("commit remains checkout-local and never chains into Orchard integration", async () => {
  const commit = await source("skills/commit/SKILL.md");

  expect(commit).toContain("one focused git commit");
  expect(commit).toContain("Never invoke Orchard");
  expect(commit).toContain("Never change branches or worktree lifecycle");
  expect(commit).toContain("Never merge, rebase, or push");
  expect(commit).toContain("Never choose or invoke a follow-on workflow from inside this skill");
  expect(commit).toContain("already-validated managed worktree path");
  expect(commit).toContain("Never invoke Orchard");
  expect(commit).toContain("return control to that caller after the successful commit");
});

test("Git policy rebases feature branches and forbids merge commits", async () => {
  const policy = await source("rules/git-commit.md");

  expect(policy).toContain("Rebase local feature branches");
  expect(policy).toContain("Never create merge commits");
  expect(policy).toContain("fast-forward only");
});

test("Claude permits Orchard lifecycle and native transitions without broad Git bypasses", async () => {
  const settings = JSON.parse(await source("harnesses/claude/settings.json"));
  const allowed = settings.permissions.allow as string[];

  expect(allowed).toContain("Bash(command -v orchard)");
  expect(allowed).toContain("Bash(orchard)");
  expect(allowed).toContain("Bash(orchard *)");
  expect(allowed).toContain("EnterWorktree");
  expect(allowed).toContain("ExitWorktree");
  expect(allowed).not.toContain("Bash(git *)");
});
