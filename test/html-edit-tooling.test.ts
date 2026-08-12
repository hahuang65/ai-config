import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("code skill forbids every command-line text transformer for tasks.html edits, not one language", async () => {
  const skill = await source("skills/code/SKILL.md");

  expect(skill).toContain("Make these changes with the harness Edit tool as exact string replacements");
  expect(skill).toContain("Never modify the file through a Bash command");
  // Pin the class, not an example: a language-specific ban invited the Perl workaround.
  expect(skill).toContain("not one language");
  for (const transformer of ["python3", "perl", "ruby", "node", "sed", "awk", "ed"]) {
    expect(skill).toContain(`\`${transformer}\``);
  }
  expect(skill).not.toContain("Python heredoc");
});

test("change reviewer forbids every command-line text transformer for HTML reading", async () => {
  const agent = await source("agents/change-reviewer.md");

  expect(agent).toContain("Read HTML artifacts such as `specs.html` and `tasks.html` directly with the Read tool");
  expect(agent).toContain("Never shell out to any command-line text transformer");
  for (const transformer of ["python3 -c", "perl -e", "ruby -e", "node -e", "sed", "awk"]) {
    expect(agent).toContain(`\`${transformer}\``);
  }
});
