import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const SETTINGS_PATH = new URL("../harnesses/claude/settings.json", import.meta.url);

const A5_COMMANDS = [
  "a5 auth codeartifact",
  "a5 auth ecr",
  "a5 creds renew",
  "a5 docker up",
  "a5 docker down",
  "a5 docker ps",
  "a5 docker logs",
  "a5 docker run",
] as const;

test("Claude can run ESLint through npx without prompting", async () => {
  const settings = JSON.parse(await readFile(SETTINGS_PATH, "utf8"));
  const allowed = settings.permissions.allow as string[];

  expect(allowed).toContain("Bash(npx eslint)");
  expect(allowed).toContain("Bash(npx eslint *)");
});

test("Claude can run the approved A5 commands without prompting", async () => {
  const settings = JSON.parse(await readFile(SETTINGS_PATH, "utf8"));
  const allowed = settings.permissions.allow as string[];

  for (const command of A5_COMMANDS) {
    expect(allowed).toContain(`Bash(${command})`);
    expect(allowed).toContain(`Bash(${command} *)`);
  }
});
