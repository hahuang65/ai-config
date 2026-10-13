import { expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const agents = fileURLToPath(new URL("../agents/", import.meta.url));
const retiredRoles = ["architecture-reviewer", "change-fixer", "refactorer", "tdd-guide"];
const names = ["api-designer", "change-reviewer", "database-reviewer",
  "fact-checker", "frontend-architect"];

test("Claude-discovered specialists expose read-only tools instead of inheriting edit and shell tools", () => {
  for (const name of names) {
    const body = readFileSync(join(agents, `${name}.md`), "utf8");
    const header = body.split("\n---\n", 1)[0];
    expect(header).toContain('tools: ["Read", "Grep", "Glob"]');
  }
});

test("an ordinary change-reviewer agent cannot claim the restricted review workflow", () => {
  const body = readFileSync(join(agents, "change-reviewer.md"), "utf8");
  expect(body).toContain("Ordinary agent discovery does not provide a frozen review snapshot");
  expect(body).toContain("review-change skill");
  expect(body).toContain("not a verified change review");
});

test("retired roles do not remain beside the replacement specialists", () => {
  for (const name of retiredRoles) expect(existsSync(join(agents, `${name}.md`))).toBe(false);
  for (const name of names) expect(existsSync(join(agents, `${name}.md`))).toBe(true);
});

test("replacement owns all ordinary specialist definitions without the old source", () => {
  expect(readdirSync(agents).sort()).toEqual(names.map((name) => `${name}.md`).sort());
  for (const name of names) {
    const file = join(agents, `${name}.md`);
    expect(existsSync(file)).toBe(true);
    const body = readFileSync(file, "utf8");
    expect(body).toMatch(new RegExp(`^---\\nname: ${name}\\n`, "m"));
    expect(body).not.toContain("~/.dotfiles/ai");
  }
});
