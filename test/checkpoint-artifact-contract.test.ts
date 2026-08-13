import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const REPOSITORY = path.join(import.meta.dir, "..");

async function source(relativePath: string) {
  return readFile(path.join(REPOSITORY, relativePath), "utf8");
}

test("grill keeps every question round in chat", async () => {
  const grill = await source("skills/grill/SKILL.md");
  const guide = await source("skills/grill/guide.html");

  expect(grill).toContain("Keep every grill round in chat");
  expect(grill).not.toContain("temporary HTML artifact");
  expect(guide).toContain("Every grill round stays in chat");
});

test("spec uses an approval artifact only when its sketch exceeds four modules", async () => {
  const spec = await source("skills/spec/SKILL.md");
  const guide = await source("skills/spec/guide.html");
  const context = await source("CONTEXT.md");

  expect(spec).toContain("more than four modules");
  expect(spec).toContain("temporary module-sketch HTML artifact");
  expect(spec).toContain("one bounded card per module");
  expect(spec).toContain("`approval` purpose and `explore` mode");
  expect(spec).toContain("four or fewer modules");
  expect(spec).toContain("This replaces the existing chat confirmation");
  expect(guide).toContain("More than four modules use an approval artifact in Explore mode");
  expect(context).toContain("Spec module-sketch approval reviews explicitly start in Explore mode");
});
