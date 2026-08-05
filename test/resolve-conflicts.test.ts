import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("resolve-conflicts is a thin alias to the conflict-resolution skill", async () => {
  const command = await source("commands/resolve-conflicts.md");

  expect(command).toContain("Load and follow the `resolve-conflicts` skill");
  expect(command).toContain("forwarding `$ARGUMENTS` unchanged");
});

test("conflict resolution preserves both intents when they are compatible", async () => {
  const skill = await source("skills/resolve-conflicts/SKILL.md");
  const workflow = await source("skills/resolve-conflicts/references/workflow.md");

  expect(skill).toContain("references/workflow.md");
  expect(workflow).toContain("primary sources");
  expect(workflow).toContain("Preserve both intents where possible");
  expect(workflow).toContain("Do not invent new behavior");
  expect(workflow).toContain("never abort");
});

test("incompatible hunks require one submitted human decision per hunk", async () => {
  const workflow = await source("skills/resolve-conflicts/references/workflow.md");
  const review = await source("skills/resolve-conflicts/references/conflict-review.md");

  expect(workflow).toContain("only incompatible hunks remain");
  expect(workflow).toContain("continue to automated checks");
  expect(review).toContain("one required choice per incompatible hunk");
  expect(review).toContain("Submit resolutions");
  expect(review).toContain("`review:submit`");
  expect(review).toContain("decision review");
  expect(review).toContain("untrusted input");
});

test("conflict resolution verifies and completes every operation step", async () => {
  const workflow = await source("skills/resolve-conflicts/references/workflow.md");

  expect(workflow).toContain("typecheck");
  expect(workflow).toContain("tests");
  expect(workflow).toContain("format");
  expect(workflow).toContain("If continuing a rebase exposes another conflict");
  expect(workflow).toContain("git-commit.md");
});

test("working-state restoration returns to its owner without committing", async () => {
  const skill = await source("skills/resolve-conflicts/SKILL.md");
  const workflow = await source("skills/resolve-conflicts/references/workflow.md");

  expect(skill).toContain("working-state restoration conflict");
  expect(workflow).toContain("Working-state restoration mode");
  expect(workflow).toContain("Do not stage, commit, or continue a Git operation");
  expect(workflow).toContain("return control to the owning workflow");
  expect(workflow).toContain("Drop the recovery stash only after");
});

test("the Git rule reserves in-progress conflict mutation for explicit resolution", async () => {
  const rule = await source("rules/git-commit.md");

  expect(rule).toContain("`/resolve-conflicts`");
  expect(rule).toContain("in-progress conflict");
  expect(rule).toContain("explicitly asks");
});
