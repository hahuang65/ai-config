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

test("Confluence writes stay on the two designated pages", async () => {
  const protocol = await source("skills/shared/references/domain-documentation.md");
  const contextFormat = await source("skills/model-domain/references/context-format.md");
  const decisionFormat = await source("skills/model-domain/references/adr-format.md");

  expect(protocol).toContain("Never create any Confluence page");
  expect(contextFormat).toContain("Never create or write to subordinate or linked context pages");
  expect(decisionFormat).toContain("Write every contract to the saved decisions document");
  expect(decisionFormat).toContain("If **Contracts** does not exist, create that section");
  expect(decisionFormat).toContain("Never create a page for a contract");
});

test("Confluence decision cards include the scenario behind the decision", async () => {
  const decisionFormat = await source("skills/model-domain/references/adr-format.md");

  expect(decisionFormat).toContain("**Scenario**");
  expect(decisionFormat).toContain("short, concrete, plain-language example");
  expect(decisionFormat).toContain("scenario that led to this decision");
});

test("local decision records preserve context and add a concrete scenario", async () => {
  const decisionFormat = await source("skills/model-domain/references/adr-format.md");

  expect(decisionFormat).toContain("{One short, concrete, plain-language scenario that exposed the problem.}");
  expect(decisionFormat).toContain("{1-3 sentences: what is the context, what did we decide, and why.}");
  expect(decisionFormat).toContain("The scenario is additive");
});

test("Confluence contracts use visually cohesive cards", async () => {
  const decisionFormat = await source("skills/model-domain/references/adr-format.md");

  expect(decisionFormat).toContain("Keep each contract as one visually cohesive card");
  expect(decisionFormat).toContain("one `panel-note` panel containing the complete contract");
  expect(decisionFormat).toContain("background color");
});
