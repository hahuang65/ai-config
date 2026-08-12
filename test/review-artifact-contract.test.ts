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
    expect(content).toContain("context documentation");
    expect(content).toContain("common technical terms");
  }
  expect(reviewChange).toContain("human-readable labels");
  expect(reviewCode).not.toContain("Use exactly:");
});

test("the harness baseline standardizes understandable communication", async () => {
  const baseline = await source("baseline-prompt.md");

  expect(baseline).toContain("Communicate clearly and concisely");
  expect(baseline).toContain("written communication and visual artifacts enough context to stand alone");
  expect(baseline).toContain("user-facing prose in chat, Markdown, and HTML");
  expect(baseline).toContain("ASD-STE100 Simplified Technical English");
  expect(baseline).toContain("`CONTEXT.md` and `CONTEXT-MAP.md` collectively as **context files**");
  expect(baseline).toContain("ubiquitous language");
  expect(baseline).toContain("The documentation is the durable record of that language, not the language itself");
  expect(baseline).toContain("Define unfamiliar terms at first use");
  expect(baseline).toContain("In Markdown, put each complete sentence on its own line");
});

test("the harness baseline owns shared workflow semantics", async () => {
  const baseline = await source("baseline-prompt.md");
  const skills = await Promise.all([
    "build", "coach", "code", "grill", "refactor", "spec", "todo", "visualize-diff",
  ].map((name) => source(`skills/${name}/SKILL.md`)));

  expect(baseline).toContain("Do not stage, commit, push, or deliver unless");
  expect(baseline).toContain("Interpret confirmation by meaning, not by keyword");
  expect(baseline).toContain("Route HTML by purpose");
  expect(baseline).toContain("use `review-artifact`");
  expect(baseline).toContain("Browser close, disconnect, timeout, or ending a session is not approval");
  expect(baseline).toContain("before designing a test strategy or writing or modifying tests");
  expect(baseline).toContain("before designing or writing code involving external input");
  expect(baseline).toContain("before designing or implementing optimization");
  for (const skill of skills) expect(skill).not.toContain("Ultrathink.");
  for (const skill of skills.slice(1, 3).concat(skills.slice(5, 7))) {
    expect(skill).not.toContain("## Rules Adherence");
  }
});

test("review artifacts declare interaction mode and document-title intent", async () => {
  const skill = await source("skills/review-artifact/SKILL.md");
  const protocol = await source("skills/shared/references/review-artifact.md");
  const spec = await source("skills/spec/references/spec-template.md");
  const tasks = await source("skills/todo/references/task-template.md");
  const report = await source("skills/review-change/references/report.md");

  expect(skill).toContain("--purpose <feedback|approval|decision>");
  expect(protocol).toContain("Feedback and approval reviews start in **Annotate** mode");
  expect(protocol).toContain("Decision reviews start in **Explore** mode");
  expect(protocol).toContain("`<document title> - <document intent>`");
  expect(spec).toContain("`<feature title> - Spec`");
  expect(tasks).toContain("`<feature title> - Tasks`");
  expect(report).toContain("`<change title> - Review Findings`");
});

test("build review decisions are completed in each issue card and submitted once", async () => {
  const report = await source("skills/review-change/references/report.md");
  const context = await source("CONTEXT.md");

  expect(context).toContain("An artifact-owned decision form completes its review when submitted");
  expect(context).toContain("submitting that form completes the current browser review round");
  expect(report).toContain("one HTML `<form>`");
  expect(report).toContain("inside that Finding's card");
  expect(report).toContain('`form="review-decisions"`');
  expect(report).toContain("name the exact Finding");
  expect(report).toContain('type: `review:submit`');
  expect(report).toContain("Set `completion` to `approve`");
  expect(report).toContain("set `completion` to `end`");
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
