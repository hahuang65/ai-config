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

  expect(commandNames).toEqual(["deliver", "rebase"]);
  expect(skillNames).toContain("build");
  expect(skillNames).not.toContain("deliver");
  expect(skillNames).not.toContain("merge");
  for (const commandName of commandNames) expect(skillNames).not.toContain(commandName);
});

test("deliver routes only managed tasks through Orchard", async () => {
  const delivery = await source("commands/deliver.md");

  expect(delivery).toContain("classify the checkout using Git only");
  expect(delivery).toContain("explicit worktree intent");
  expect(delivery).toContain("canonical `~/.orchard/` root");
  expect(delivery).toContain("load the `orchard` skill");
  expect(delivery).toContain("Never invoke Orchard");
  expect(delivery).toContain("ordinary local feature branch");
  expect(delivery).toContain("git merge --ff-only");
  expect(delivery).toContain("git pr create --web --fill");
});

test("deliver accepts a primary absorbed submodule without accepting linked worktrees", async () => {
  const delivery = await source("commands/deliver.md");

  expect(delivery).toContain("absorbed Git submodule");
  expect(delivery).toContain("git rev-parse --absolute-git-dir");
  expect(delivery).toContain("git rev-parse --git-common-dir");
  expect(delivery).toContain("git rev-parse --show-superproject-working-tree");
  expect(delivery).toContain("core.worktree");
  expect(delivery).toContain("absolute Git directory and common Git directory to match");
  expect(delivery).toContain("resolve to the current Git root");
});

test("rebase is a thin Orchard alias", async () => {
  const rebase = await source("commands/rebase.md");

  expect(rebase).toContain("Load and follow the `orchard` skill for its rebase operation");
  expect(rebase).not.toContain("Run Orchard preflight");
  expect(rebase).not.toContain("orchard rebase $ARGUMENTS");
});

test("the active README inventory lists deliver and rebase as commands", async () => {
  const readme = await source("README.md");

  expect(readme).toContain("Shared explicit aliases and compositions (deliver, rebase)");
  expect(readme).toContain("`deliver` routes managed worktrees through Orchard");
  expect(readme).toContain("ordinary branches directly through Git");
  expect(readme).not.toContain("`deliver` | — | Commit outstanding changes when needed");
  expect(readme).not.toContain("`merge` | — | Rebase and fast-forward ordinary Orchard tasks");
});

test("the harness baseline identifies A5 projects once", async () => {
  const baseline = await source("harness-system-prompt.md");
  const delivery = await source("commands/deliver.md");

  expect(baseline).toContain("An **A5 project** has effective trusted Git configuration `ai.projectFamily=a5`");
  expect(baseline).toContain("Accept only global or system Git scope");
  expect(baseline).toContain("originating repository");
  expect(baseline).not.toContain("~/Projects/a5/");
  expect(delivery).toContain("A5 project");
  expect(delivery).toContain("global or system");
});
