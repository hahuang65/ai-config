import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { POLICIES } from "../guard/policy-registry";

const root = new URL("../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
type ResourceLink = { destination: string; target: string };

function missingResourceMappings(links: ResourceLink[], catalogue: string) {
  const rows = catalogue.split("\n").filter(line => line.startsWith("|"))
    .map(line => line.split("|").slice(1, 3));
  return links.filter(link => !rows.some(([source, routes]) => source?.includes(`](../${link.target})`)
    && routes?.includes(`\`${link.destination}\``)));
}

test("harness contracts catalogue every managed resource and settings path", () => {
  const manifest = JSON.parse(read("manifest.json"));
  const catalogue = read("docs/harness-contracts.md");
  expect(missingResourceMappings(manifest.links, catalogue)).toEqual([]);
  for (const setting of manifest.settings) {
    expect(catalogue, `Missing settings destination: ${setting.destination}`).toContain(`\`${setting.destination}\``);
    const row = catalogue.split("\n").find(line => line.startsWith(`| \`${setting.destination}\` |`)
      && line.includes(`\`${setting.path.join(".")}\``));
    expect(row, `Missing settings path: ${setting.destination}:${setting.path.join(".")}`).toBeDefined();
  }
  expect(read("README.md")).toContain("docs/harness-contracts.md");
  expect(read("docs/harness-tool-inventory.md")).toContain("harness-contracts.md");
  expect(read("docs/new-harness-checklist.md")).toContain("harness-contracts.md");
});

test("new and renamed destinations cannot reuse a documented source silently", () => {
  const catalogue = read("docs/harness-contracts.md");
  const original = { destination: ".claude/CLAUDE.md", target: "baseline.md" };
  expect(missingResourceMappings([original], catalogue)).toEqual([]);
  const added = { ...original, destination: ".claude/EXTRA.md" };
  const renamed = { ...original, destination: ".claude/RENAMED.md" };
  for (const links of [[original, added], [renamed]]) {
    expect(missingResourceMappings(links, catalogue)).toEqual([links.at(-1)!]);
  }
  const wrongTarget = { ...original, target: "commands/deliver.md" };
  expect(missingResourceMappings([wrongTarget], catalogue)).toEqual([wrongTarget]);
  const supportTarget = { destination: ".claude/hooks/guard.ts", target: "harnesses/claude/guard-verdict.ts" };
  expect(missingResourceMappings([supportTarget], catalogue)).toEqual([supportTarget]);
});

test("current domain documentation has no selectable external destination", () => {
  for (const path of ["CONTEXT.md", "docs/harness-contracts.md", "docs/new-harness-checklist.md"]) {
    expect(read(path), path).not.toMatch(/Confluence|domain-documentation\.json|per-linked-worktree documentation destination/i);
  }
  const skillRow = read("docs/harness-contracts.md").split("\n")
    .find(line => line.startsWith("| [model-domain]"));
  expect(skillRow).toContain("Local context files and Markdown ADRs");
  expect(skillRow).toContain("classification affects A5 privacy only");
});

test("the readable policy matrix tracks every registry policy and its floor", () => {
  const catalogue = read("docs/harness-contracts.md");
  const rows = catalogue.split("\n").filter(line => /^\| `no-/.test(line));
  expect(rows).toHaveLength(POLICIES.length);
  for (const policy of POLICIES) {
    expect(rows).toContain(`| \`${policy.id}\` | ${policy.floor ? "Yes" : "No"} | B | A |`);
  }
});

test("contract and checklist source references resolve within the package", () => {
  for (const path of ["docs/harness-contracts.md", "docs/new-harness-checklist.md"]) {
    for (const match of read(path).matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
      const target = match[1];
      // Release files are created by make build; this check covers source navigation.
      if (target.includes("/target/release/")) continue;
      expect(existsSync(new URL(target, new URL(path, root))), `${path}: ${target}`).toBe(true);
    }
  }
});
