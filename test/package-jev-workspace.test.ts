import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workspaceSource, reviewSources } from "../tools/project-pi.mjs";

test("native workspace roots follow canonical repository ancestors without changing inherited context", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jev-workspace-")));
  const previous = process.env.AI_REVIEW_EXCLUDED_SOURCES;
  try {
    const repo = join(root, "repo"), nested = join(repo, "deep/work"), inherited = join(root, "inherited");
    mkdirSync(nested, { recursive: true });
    mkdirSync(inherited);
    writeFileSync(join(repo, ".git"), "gitdir: ../unread-metadata\n");
    const alias = join(root, "alias");
    symlinkSync(nested, alias, "dir");
    const raw = JSON.stringify([inherited]);
    process.env.AI_REVIEW_EXCLUDED_SOURCES = raw;
    expect(workspaceSource(alias)).toBe(repo);
    const additional = [workspaceSource(alias), repo];
    expect(reviewSources(additional)).toEqual([inherited, repo]);
    expect(additional).toEqual([repo, repo]);
    expect(process.env.AI_REVIEW_EXCLUDED_SOURCES).toBe(raw);
    expect(() => workspaceSource("relative")).toThrow();
    expect(() => workspaceSource(join(repo, ".git"))).toThrow();
  } finally {
    if (previous === undefined) delete process.env.AI_REVIEW_EXCLUDED_SOURCES; else process.env.AI_REVIEW_EXCLUDED_SOURCES = previous;
    rmSync(root, { recursive: true, force: true });
  }
});

test.each(["not-json", '["relative"]', JSON.stringify(Array(129).fill("/source")), "x".repeat(32769)])
  ("invalid inherited source context %# is refused rather than discarded", value => {
    const previous = process.env.AI_REVIEW_EXCLUDED_SOURCES;
    try {
      process.env.AI_REVIEW_EXCLUDED_SOURCES = value;
      expect(() => reviewSources(["/workspace"])).toThrow("Invalid review source exclusions");
      expect(process.env.AI_REVIEW_EXCLUDED_SOURCES).toBe(value);
    } finally { if (previous === undefined) delete process.env.AI_REVIEW_EXCLUDED_SOURCES; else process.env.AI_REVIEW_EXCLUDED_SOURCES = previous; }
  });
