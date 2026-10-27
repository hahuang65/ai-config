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

test("delivery preserves integration guards and permits a needed authorized review", () => {
  const instructions = readFileSync(`${root}/commands/deliver.md`, "utf8");
  expect(instructions).toContain("stop before integration if required checks fail or remain incomplete");
  expect(instructions).toContain("git merge --ff-only");
  expect(instructions).toContain("prove its tip equals the verified tip");
  expect(instructions).not.toContain("Do not start a provider review during delivery");
  expect(instructions).toContain("Use `review-change` for a needed authorized review");
  expect(instructions).toContain("Do not repeat a current review of the same source and intent");
  expect(instructions).not.toContain("reviewed feature tip");
  expect(instructions).toContain("wt clean TASK --check --json");
  expect(instructions).toContain("Verify its actual directory, repository, and integration branch before removing anything");
  expect(instructions).toContain("Then run `wt clean TASK --json` from primary");
  expect(instructions).toContain("PR preparation is not integration and does not authorize cleanup");
});

test("delivery reuses commit checks only for the unchanged verified revision", () => {
  const instructions = readFileSync(`${root}/commands/deliver.md`, "utf8");
  expect(instructions).toContain("Commits always run the required project checks");
  expect(instructions).toContain("Do not repeat successful commit checks for the unchanged verified revision");
  expect(instructions).toContain("A real rebase invalidates prior verification");
  expect(instructions).toContain("after rebase and before integration");
  expect(instructions).toContain("Missing or uncertain verification is not reusable");
});

test("rebase asks for a separate provider review only when needed authorization is missing", () => {
  const instructions = readFileSync(`${root}/commands/rebase.md`, "utf8");
  expect(instructions).toContain("not implicit in this rebase");
  expect(instructions).toContain("only when it is not already explicitly authorized for this scope");
  expect(instructions).toContain("report an incomplete review honestly");
  expect(instructions).toContain("Never push, delete a branch, integrate, or clean a worktree here");
});

test("a no-op rebase does not discard exact current verification", () => {
  const instructions = readFileSync(`${root}/commands/rebase.md`, "utf8");
  expect(instructions).toContain("A no-op rebase preserves exact current verification");
  expect(instructions).toContain("A changed tip requires fresh checks after rebase and before integration");
});

test("installed package README describes checked delivery and separate review", () => {
  const readme = readFileSync(`${root}/README.md`, "utf8");
  expect(readme).toContain("## Installed package");
  expect(readme).toContain("The installed package provides:");
  expect(readme).toContain("Local delivery requires project checks and a verified fast-forward");
  expect(readme).toContain("provider review is a separate, explicitly requested workflow");
  expect(readme).not.toContain("reviewed task");
});
