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

test("deliver delegates policy to Orchard and uses commit only for a needs-commit outcome", async () => {
  const delivery = await source("commands/deliver.md");

  expect(delivery).toContain("`orchard` skill for its deliver operation");
  expect(delivery).toContain("`needs-commit`");
  expect(delivery).toContain("`commit` skill");
  expect(delivery).toContain("managed task or ordinary local branch");
  expect(delivery).toContain("exact checkout path and branch");
  expect(delivery).toContain("Do not treat the delivery argument as commit scope");
  expect(delivery).toContain("retry Orchard deliver");
  expect(delivery).not.toContain("A5 project");
  expect(delivery).not.toContain("git pr create --web --fill");
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
  expect(readme).toContain("`deliver` delegates delivery policy to Orchard");
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
  expect(delivery).not.toContain("A5 project");
});
