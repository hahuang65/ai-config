import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("explicit deliver and rebase prompts are shared by Claude and Pi without Orchard", () => {
  const manifest = JSON.parse(readFileSync(`${root}/manifest.json`, "utf8"));
  for (const name of ["deliver", "rebase"]) {
    const source = `commands/${name}.md`;
    for (const destination of [`.claude/commands/${name}.md`, `.pi/agent/prompts/${name}.md`]) {
      expect(manifest.links).toContainEqual({ destination, target: source });
    }
    const text = readFileSync(`${root}/${source}`, "utf8");
    expect(text).toContain("resolve-conflicts");
    expect(text).not.toMatch(/orchard|~\/.dotfiles\/ai/i);
    expect(text).toMatch(/never push/i);
  }
  expect(readFileSync(`${root}/commands/deliver.md`, "utf8"))
    .toContain("git merge --ff-only");
});
