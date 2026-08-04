import { expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("shared commands project to Claude commands and pi prompt templates", async () => {
  expect(await source("harnesses/claude/manifest.sh")).toContain('command_target="commands"');
  expect(await source("harnesses/pi/manifest.sh")).toContain('command_target="prompts"');
  expect(await source("install.sh")).toContain("command_target");
});

test("the curated command set does not duplicate same-named skills", async () => {
  const commandNames = (await readdir(path.join(REPOSITORY, "commands"), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name.replace(/\.md$/, ""))
    .sort();
  const skillNames = (await readdir(path.join(REPOSITORY, "skills"), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name !== "shared")
    .map((entry) => entry.name);

  expect(commandNames).toEqual(["rebase"]);
  expect(skillNames).toContain("build");
  expect(skillNames).toContain("deliver");
  expect(skillNames).not.toContain("merge");
  for (const commandName of commandNames) expect(skillNames).not.toContain(commandName);
});

test("deliver is a skill because pi resolves matching requests from skill metadata", async () => {
  const context = await source("CONTEXT.md");
  const delivery = await source("skills/deliver/SKILL.md");

  expect(context).toContain("Pi can resolve a matching request to a skill from its advertised name and description");
  expect(context).toContain("`/skill:<name>`");
  expect(delivery).toContain("[the commit skill](../commit/SKILL.md)");
  expect(delivery).toContain("If the checkout has changes");
  expect(delivery).toContain("If the checkout is already clean, skip committing");
});

test("rebase is a thin Orchard alias", async () => {
  const rebase = await source("commands/rebase.md");

  expect(rebase).toContain("Load and follow the `orchard` skill for its rebase operation");
  expect(rebase).not.toContain("Run Orchard preflight");
  expect(rebase).not.toContain("orchard rebase $ARGUMENTS");
});

test("the active README inventory lists rebase as the command and deliver as the skill", async () => {
  const readme = await source("README.md");

  expect(readme).toContain("Shared explicit aliases (rebase)");
  expect(readme).toContain("`deliver` | — | Commit outstanding changes when needed");
  expect(readme).not.toContain("skill compositions (deliver, rebase)");
  expect(readme).not.toContain("`deliver` composes `commit` with `merge`");
  expect(readme).not.toContain("`merge` | — | Rebase and fast-forward ordinary Orchard tasks");
});

test("the harness baseline identifies A5 projects once", async () => {
  const baseline = await source("harness-system-prompt.md");
  const delivery = await source("skills/deliver/SKILL.md");

  expect(baseline).toContain("An **A5 project** is a repository whose main project directory's canonical physical path is beneath `~/Projects/a5/`");
  expect(baseline).toContain("Git worktree metadata");
  expect(delivery).toContain("A5 project");
  expect(delivery).toContain("git pr create --web --fill");
  expect(delivery).not.toContain("~/Projects/a5/");
});
