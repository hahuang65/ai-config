import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { copyPackageFiles } from "./fixtures/inactive-package";

const harnesses = [".claude", ".pi/agent"];
const root = resolve(import.meta.dir, "..");

function withInstalledInstructions(check: (home: string, source: string) => void) {
  const home = mkdtempSync(join(tmpdir(), "instruction-routing-"));
  const source = join(home, "configuration source");
  try {
    copyPackageFiles(source);
    const manifest = JSON.parse(readFileSync(join(source, "manifest.json"), "utf8"));
    for (const { destination, target } of manifest.links) {
      if (target !== "baseline.md" && !target.startsWith("skills/")) continue;
      const link = join(home, destination);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(join(source, target), link);
    }
    check(home, source);
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test("installed change-review skills load one source-owned finding-decision protocol", () => {
  withInstalledInstructions((home, source) => {
    for (const harness of harnesses) {
      const entry = realpathSync(join(home, harness, "skills/review-change/SKILL.md"));
      const caller = readFileSync(entry, "utf8");
      const reference = caller.match(/read and follow \[review-artifact\]\(([^)]+)\)/);
      expect(reference).not.toBeNull();
      const protocolPath = resolve(dirname(entry), reference![1]);
      expect(protocolPath).toBe(realpathSync(join(source, "skills/review-artifact/SKILL.md")));
      const protocol = readFileSync(protocolPath, "utf8");
      for (const requirement of ["Only the human", "finding_review.needs_review", "matching event/current/bound revisions",
        "SHA-256 equal to `finding_review.report_digest`", "last processed cursor", "same reply ID and content",
        "no inactivity cutoff", "A saved decision cannot be overwritten", "new retained report and new decisions"]) {
        expect(protocol).toContain(requirement);
      }
      expect(caller).not.toContain("finding_review.report_digest");
      expect(caller).not.toContain("finding_review.needs_review");
      expect(caller).toContain("coach mode");
      expect(caller).toContain("Never rewrite the retained report");
    }
  });
});

test("installed domain-modeling skills use the bootstrap-owned documentation conventions", () => {
  withInstalledInstructions((home, source) => {
    for (const [harness, bootstrap] of [[".claude", "CLAUDE.md"], [".pi/agent", "AGENTS.md"]]) {
      const caller = readFileSync(join(home, harness, "skills/model-domain/SKILL.md"), "utf8");
      expect(caller).toContain("absolute global instruction symlink target");
      const reference = caller.match(/Read `(rules\/documentation\.md)`/);
      expect(reference).not.toBeNull();
      const owner = dirname(realpathSync(join(home, harness, bootstrap)));
      const rulePath = resolve(owner, reference![1]);
      expect(rulePath).toBe(realpathSync(join(source, "rules/documentation.md")));
      const rule = readFileSync(rulePath, "utf8");
      for (const requirement of ["not a task log, specification, or copy of the source code",
        "only when the project has separate contexts", "problem, decision, alternatives, reasons, and consequences",
        "costly to reverse", "Do not create a decision record for routine implementation choices"]) {
        expect(rule).toContain(requirement);
      }
      expect(caller).not.toContain("Include the problem, decision, alternatives");
      expect(caller).not.toContain("Use `CONTEXT-MAP.md` only when");
      expect(caller).toContain("preserve the history of superseded decisions");
      expect(caller).toContain("Do not invent decisions");
    }
  });
});

test("package overview routes readers to the complete native transition contract", () => {
  const overview = readFileSync(join(root, "README.md"), "utf8");
  const reference = overview.match(/\[Native task adapters\]\(([^)]+)\)/);
  expect(reference).not.toBeNull();
  const contract = readFileSync(resolve(root, reference![1]), "utf8");
  for (const requirement of ["## Shared continuation contract", "## Pi", "## Claude Code",
    "`/wt leave`", "`/wt clean TASK`", "not exclusive ownership", "cannot invoke `/resume`",
    "actual host directory", "never force the branch deletion"]) {
    expect(contract).toContain(requirement);
  }
  expect(overview).toContain("interactive `/resume` still requires a subsequent `continue`");
  expect(overview).toContain("does not move a running conversation");
});
