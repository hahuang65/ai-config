import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("only A5 linked worktrees ask where domain documentation should live", async () => {
  const protocol = await source("skills/shared/references/domain-documentation.md");
  const modelDomain = await source("skills/model-domain/SKILL.md");
  const context = await source("CONTEXT.md");

  expect(protocol).toContain("Use the harness baseline to classify the checkout as an A5 project");
  expect(protocol).not.toContain("ai.projectFamily");
  expect(protocol).toContain("For every non-A5 project, use local files without prompting and do not read or create destination state");
  expect(protocol).toContain("Only an A5 linked worktree can reuse or select a local-or-Confluence destination");
  expect(modelDomain).toContain("only for an A5 linked worktree");
  expect(context).toContain("Only an A5 linked worktree can select Confluence");
});
