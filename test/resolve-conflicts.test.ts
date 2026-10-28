import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { installedSdkFile } from "./fixtures/installed-pi-sdk";

const root = resolve(import.meta.dir, "..");
const skill = join(root, "skills/resolve-conflicts/SKILL.md");
const workflow = join(root, "skills/resolve-conflicts/references/workflow.md");
const text = () => readFileSync(workflow, "utf8");
function requires(content: string, contracts: RegExp[]) {
  for (const contract of contracts) expect(content).toMatch(contract);
}

test("Pi parses the rebase-only skill through an explicit path", async () => {
  const sdk = await import(join(dirname(installedSdkFile()), "core/skills.js"));
  const loaded = sdk.loadSkills({ cwd: root, agentDir: join(root, ".unused-resolve-profile"), includeDefaults: false, skillPaths: [skill] });
  expect(loaded.diagnostics).toEqual([]);
  expect(loaded.skills.map((entry: { name: string }) => entry.name)).toEqual(["resolve-conflicts"]);
});

test("the rebase skill stays thin and has only local, resolvable dependencies", () => {
  const entry = readFileSync(skill, "utf8");
  expect(entry.length).toBeLessThan(3500);
  expect(entry).toContain("references/workflow.md");
  for (const path of [skill, workflow]) {
    const content = readFileSync(path, "utf8");
    expect(content.split("\n").length).toBeLessThan(400);
    expect(content).not.toMatch(/Orchard|agentmemory|review:submit|<form|~\/\.dotfiles/);
    for (const match of content.matchAll(/\]\(([^)#]+\.md)(?:#[^)]*)?\)/g)) {
      const target = resolve(dirname(path), match[1]);
      expect(target.startsWith(`${root}/skills/`)).toBe(true);
      expect(readFileSync(target, "utf8").length).toBeGreaterThan(0);
    }
  }
});

test("resolution authorizes existing rebase continuation but not another lifecycle", () => {
  requires(text(), [
    /explicit.*request.*authorizes/i, /already.*(?:running|active).*rebase/i,
    /git rebase --continue/, /git rev-parse --git-path/, /git ls-files -u -z/,
    /No supported.*stop/i, /interactive.*(?:edit|break|exec)/i,
    /Do not.*(?:start|begin).*rebase/i, /Do not.*(?:merge|stash)/i,
    /Do not.*(?:skip|abort).*reset/i, /Never.*push/i, /stop.*merge commits.*exec/i,
  ]);
});

test("resolution preserves intent and unrelated state instead of choosing a side or hiding failures", () => {
  requires(text(), [
    /original.*(?:tip|HEAD)/i, /target.*tip/i, /REBASE_HEAD/, /untrusted evidence/i,
    /both.*intent/i, /incompatible.*chat/i, /explicit choice/i, /ours.*theirs/i,
    /staged.*unstaged.*untracked/i, /unrelated.*(?:stage|index)/i,
    /already staged/i, /literal.*path/i, /deletions/i, /unrelated unstaged.*stop before staging/i,
    /type.*test.*lint/i, /failed.*(?:check|test)/i, /empty.*stop/i,
  ]);
});

test("completed rebases still require whole-task review and selected repair ownership", () => {
  requires(text(), [
    /review-change\/SKILL\.md/, /target.*\.\..*(?:tip|HEAD)/i,
    /committed.*uncommitted/i, /unavailable.*incomplete/i,
    /selected.*repairs/i, /fresh review/i, /coach.*user/i,
    /worklog\/SKILL\.md/, /not.*(?:owning|whole).*task.*complete/i,
  ]);
});
