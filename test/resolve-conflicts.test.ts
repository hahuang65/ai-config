import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("resolve-conflicts accepts operation intent as a direct skill argument", async () => {
  const skill = await source("skills/resolve-conflicts/SKILL.md");

  expect(skill).toContain('argument-hint: "[operation-goal-or-intent]"');
  expect(skill).toContain("Treat a supplied operation goal or intent as context");
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
  expect(review).toContain("Integrate each side-specific choice into that side's evidence card");
  expect(review).toContain("custom-instructions choice as a full-width third section below the side-specific evidence cards");
  expect(review).toContain("must not appear as a nested card or box");
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

test("Orchard-owned rebases finalize through the recorded lifecycle operation", async () => {
  const workflow = await source("skills/resolve-conflicts/references/workflow.md");

  expect(workflow).toContain("Orchard rebase recovery");
  expect(workflow).toContain("operation ID");
  expect(workflow).toContain("orchard rebase --finalize-operation");
  expect(workflow).toContain("exact managed worktree");
  expect(workflow).toContain("When no unresolved path remains");
  expect(workflow).toContain("staged diff and staged path list");
  expect(workflow).toContain("do not run `git add`");
  expect(workflow).toContain("exact staged diff and staged path list are unchanged");
  expect(workflow).toContain("git commit --allow-empty --reuse-message=REBASE_HEAD");
  expect(workflow).toContain("Never use `git rebase --skip`");
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
