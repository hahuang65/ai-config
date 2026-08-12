import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("progress recaps explain decisions without relying on the earlier conversation", async () => {
  const baseline = await source("harness-system-prompt.md");
  const skill = await source("skills/grill/SKILL.md");
  const protocol = await source("skills/grill/references/session-recaps.md");
  const guide = await source("skills/grill/guide.html");

  expect(baseline).toContain("Make each progress recap understandable without the earlier conversation");
  expect(baseline).toContain("Do not write shorthand such as “control in” or “handoff out.”");
  expect(skill).toContain("[session recap protocol](references/session-recaps.md)");

  expect(protocol).toContain("## Required Structure");
  expect(protocol).toContain("**What we decided**");
  expect(protocol).toContain("**What remains open**");
  expect(protocol).toContain("**What happens next**");
  expect(protocol).toContain("## Plain-Language Check");
  expect(protocol).toContain("complete sentence");
  expect(protocol).toContain("one decision");
  expect(protocol).toContain("Do not invent a definition");
  expect(protocol).toContain("context documentation");
  expect(protocol).toContain("### Bad");
  expect(protocol).toContain("### Better");

  expect(guide).toContain("Plain-language recap");
  expect(guide).toContain("What we decided");
  expect(guide).toContain("What remains open");
  expect(guide).toContain("What happens next");
});
