import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("review artifacts use language the reviewer already knows", async () => {
  const sharedProtocol = await source("skills/shared/references/review-artifact.md");
  const reviewChange = await source("skills/review-change/references/report.md");
  const reviewCode = await source("skills/review-code/references/html-report.md");
  const visualize = await source("skills/visualize/core.md");
  const visualizeSkill = await source("skills/visualize/SKILL.md");

  for (const content of [sharedProtocol, reviewChange, reviewCode, visualize, visualizeSkill]) {
    expect(content).toContain("plain language");
    expect(content).toContain("CONTEXT.md");
    expect(content).toContain("common technical terms");
  }
  expect(reviewChange).toContain("human-readable labels");
  expect(reviewCode).not.toContain("Use exactly:");
});

test("the harness baseline standardizes understandable communication", async () => {
  const baseline = await source("harness-system-prompt.md");

  expect(baseline).toContain("Communicate clearly and concisely");
  expect(baseline).toContain("written communication and visual artifacts enough context to stand alone");
  expect(baseline).toContain("ASD-STE100 Simplified Technical English");
  expect(baseline).toContain("ubiquitous language");
  expect(baseline).toContain("CONTEXT.md");
  expect(baseline).toContain("Define unfamiliar terms at first use");
  expect(baseline).toContain("In Markdown, put each complete sentence on its own line");
});

test("build review decisions are completed in each issue card and submitted once", async () => {
  const report = await source("skills/review-change/references/report.md");

  expect(report).toContain("one HTML `<form>`");
  expect(report).toContain("inside that Finding's card");
  expect(report).toContain('type: `review:submit`');
  expect(report).toContain("Submit decisions");
  expect(report).toContain("builds the structured decision payload in the background");
  expect(report).toContain("must not display the structured payload");
  expect(report).not.toContain("copyable structured decision payload");
  expect(report).not.toContain("copy and paste");
});

test("deliver keeps ordinary branches out of Orchard", async () => {
  const delivery = await source("commands/deliver.md");
  const orchard = await source("skills/orchard/references/workflow.md");

  expect(delivery).toContain("classify the checkout using Git only");
  expect(delivery).toContain("Never invoke Orchard");
  expect(delivery).toContain("ordinary local feature branch");
  expect(delivery).toContain("returns on trunk");
  expect(delivery).toContain("git merge --ff-only");
  expect(orchard).not.toContain("ordinary local branch");
});
