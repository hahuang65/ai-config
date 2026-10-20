import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { installFixture, installerScenarioGuard } from "./fixtures/install-script";

const modules = resolve(import.meta.dir, "../tools/install");
function skillDocuments() {
  const result = spawnSync("jq", ["-L", modules, "-nc", 'include "manifest"; skills'], {
    encoding: "utf8", timeout: 10_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return Object.fromEntries((JSON.parse(result.stdout) as string[]).map(name => [name,
    `---\nname: ${name}\ndescription: Fixture instructions.\n---\n\nRead the fixture.\n`]));
}
function validate(documents: Record<string, string>) {
  const result = spawnSync("jq", ["-L", modules, "-e", 'include "skills"; valid_skills'], {
    input: JSON.stringify(documents), encoding: "utf8", timeout: 10_000,
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  return result;
}

test("batched skill front matter validates every entry, including missing captures and early false results", () => {
  const documents = skillDocuments(), names = Object.keys(documents);
  expect(validate(documents).status).toBe(0);
  for (const name of [names[0], names[Math.floor(names.length / 2)], names.at(-1)!]) {
    for (const invalid of ["No front matter.\n", "---\nname: other\ndescription: Wrong name.\n---\nBody.\n",
      `---\nname: ${name}\nname: ${name}\ndescription: Duplicate name.\n---\nBody.\n`,
      `---\nname: ${name}\n---\nBody.\n`, `---\nname: ${name}\ndescription: \t \n---\nBody.\n`,
      `---\nname: ${name}\ndescription: ${"x".repeat(1025)}\n---\nBody.\n`,
      `---\nname: ${name}\ndescription: One.\ndescription: Two.\n---\nBody.\n`,
      `---\nname: ${name}\ndescription: Empty body.\n---\n \t\n`]) {
      expect(validate({ ...documents, [name]: invalid }).status, `${name}: ${invalid.slice(0, 80)}`).not.toBe(0);
    }
  }
}, 270_000); // 26 bounded jq calls plus one command-sized cleanup margin.

test("batched front matter requires the complete catalogue and accepts the description length boundary", () => {
  const documents = skillDocuments(), name = Object.keys(documents)[0];
  documents[name] = `---\nname: ${name}\ndescription: ${"π".repeat(1024)}\n---\nBody.\n`;
  expect(validate(documents).status).toBe(0);
  const missing = { ...documents }; delete missing[name];
  expect(validate(missing).status).not.toBe(0);
  expect(validate({ ...documents, unexpected: "Not a required skill." }).status).not.toBe(0);
}, 50_000); // Four bounded jq calls plus one command-sized cleanup margin.

function expectUninstalled(setup: ReturnType<typeof installFixture>) {
  for (const path of [".claude/CLAUDE.md", ".pi/agent/AGENTS.md", ".local/state/ai-config/installation.json",
    ".local/state/ai-config/install.lock.d"]) expect(existsSync(join(setup.home, path)), path).toBe(false);
}

test("shell retains a separate UTF-8 check for each required skill before making home changes", () => {
  const setup = installFixture();
  try {
    const path = join(setup.source, "skills/worktree/SKILL.md");
    writeFileSync(path, Buffer.concat([readFileSync(path), Buffer.from([0xff])]));
    const result = setup.run();
    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain("Invalid UTF-8 skill: worktree");
    expectUninstalled(setup);
  } finally { setup.clean(); }
}, installerScenarioGuard(1));

test("skill metadata keeps its per-file 64 KiB limit below the support-file limit", () => {
  const setup = installFixture();
  try {
    const path = join(setup.source, "skills/worktree/SKILL.md"), content = readFileSync(path);
    writeFileSync(path, Buffer.concat([content, Buffer.alloc(65537 - content.length, "x")]));
    const result = setup.run();
    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain("oversized package file");
    expectUninstalled(setup);
  } finally { setup.clean(); }
}, installerScenarioGuard(1));

test("the required skill filter is checked before provisioning or building", () => {
  const setup = installFixture();
  try {
    unlinkSync(join(setup.source, "tools/install/skills.jq"));
    const result = setup.run();
    expect(result.status).toBe(1);
    expect(result.error).toBeUndefined();
    expect(setup.calls()).toBe("");
    expect(setup.provisionCalls()).toBe("");
    expect(result.stderr).toContain("skills.jq");
    expectUninstalled(setup);
  } finally { setup.clean(); }
}, installerScenarioGuard(1));
