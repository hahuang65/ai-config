import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const SETTINGS_PATH = new URL("../harnesses/claude/settings.json", import.meta.url);

test("Claude can run ESLint through npx without prompting", async () => {
  const settings = JSON.parse(await readFile(SETTINGS_PATH, "utf8"));
  const allowed = settings.permissions.allow as string[];

  expect(allowed).toContain("Bash(npx eslint)");
  expect(allowed).toContain("Bash(npx eslint *)");
});
