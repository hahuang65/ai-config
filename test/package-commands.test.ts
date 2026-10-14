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

test("delivery checks and integrates the task without starting a provider review", () => {
  const instructions = readFileSync(`${root}/commands/deliver.md`, "utf8");
  expect(instructions).toContain("stop before integration if required checks fail or remain incomplete");
  expect(instructions).toContain("git merge --ff-only");
  expect(instructions).toContain("prove its tip equals the verified tip");
  expect(instructions).toContain("Do not start a provider review during delivery");
  expect(instructions).not.toContain("review-change");
  expect(instructions).not.toContain("reviewed feature tip");
  expect(instructions).toContain("wt clean TASK --check --json");
  expect(instructions).toContain("Verify its actual directory, repository, and integration branch before removing anything");
  expect(instructions).toContain("Then run `wt clean TASK --json` from primary");
  expect(instructions).toContain("PR preparation is not integration and does not authorize cleanup");
});

test("installed package README describes checked delivery and separate review", () => {
  const readme = readFileSync(`${root}/README.md`, "utf8");
  expect(readme).toContain("## Installed package");
  expect(readme).toContain("The installed package provides:");
  expect(readme).toContain("Local delivery requires project checks and a verified fast-forward");
  expect(readme).toContain("provider review is a separate, explicitly requested workflow");
  expect(readme).not.toContain("reviewed task");
});
