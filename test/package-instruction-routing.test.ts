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

test("installed handoffs record discovery and implementation projects separately", () => {
  withInstalledInstructions(home => {
    for (const harness of harnesses) {
      const entry = realpathSync(join(home, harness, "skills/handoff/SKILL.md"));
      const handoff = readFileSync(entry, "utf8");
      const format = readFileSync(resolve(dirname(entry), "references/format.md"), "utf8");
      expect(format).toContain("`format-version`: `2`");
      for (const field of ["project-id", "checkout", "branch", "HEAD", "implementation-project-id",
        "implementation-project-name", "implementation-checkout", "implementation-branch", "implementation-HEAD"]) {
        expect(format).toContain(`- \`${field}\`:`);
      }
      expect(format).toContain("discovery project");
      expect(format).toContain("intended implementation project");
      expect(handoff).toContain("Resolve the intended implementation project separately");
      expect(handoff).toContain("Do not infer an implementation project from a repository basename");
      expect(handoff).toContain("run pickup from the intended implementation project");
      expect(format).toContain("Default the implementation project to the discovery project only when the user has not named another target");
    }
  });
});

test("installed pickup finds cross-repository handoffs by implementation identity without a discovery mismatch gate", () => {
  withInstalledInstructions(home => {
    for (const harness of harnesses) {
      const entry = realpathSync(join(home, harness, "skills/pickup/SKILL.md"));
      const pickup = readFileSync(entry, "utf8");
      const format = readFileSync(resolve(dirname(entry), "../handoff/references/format.md"), "utf8");
      expect(pickup).toContain("Filter by implementation project identity before sorting");
      expect(pickup).toContain("Apply the same project eligibility rules to explicit paths, topics, and empty invocation");
      expect(pickup).toContain("Do not ask for confirmation solely because the discovery project differs");
      expect(pickup).toContain("implementation-checkout");
      expect(pickup).toContain("implementation-branch");
      expect(pickup).toContain("implementation-HEAD");
      expect(format).toContain("Version 2 matches the current project against `implementation-project-id`");
      expect(format).toContain("A discovery-project match alone does not make a handoff eligible for a different implementation project");
    }
  });
});

test("installed cross-repository pickup preserves reference origins, legacy checks, and current authority", () => {
  withInstalledInstructions(home => {
    for (const harness of harnesses) {
      const entry = realpathSync(join(home, harness, "skills/pickup/SKILL.md"));
      const pickup = readFileSync(entry, "utf8");
      const format = readFileSync(resolve(dirname(entry), "../handoff/references/format.md"), "utf8");
      expect(format).toContain("discovery-relative");
      expect(format).toContain("implementation-relative");
      expect(format).toContain("Unqualified relative references remain relative to the discovery `checkout`");
      expect(format).toContain("Version 1 has only `project-id`, `checkout`, `branch`, and `HEAD`");
      expect(format).toContain("Do not infer an implementation target from version-one prose");
      expect(format).toContain("unsupported format versions require clarification");
      expect(format).toContain("Verify that the recorded `implementation-checkout` resolves to `implementation-project-id`");
      expect(format).toContain("An identity claim alone does not authorize reading a different checkout");
      expect(pickup).toContain("An explicit path does not authorize overriding a conflicting or unknown target identity");
      expect(pickup).toContain("implementation checkout or branch mismatch");
      expect(pickup).toContain("historical permission does not authorize new actions");
      expect(pickup).toContain("Do not switch branches or restore files");
      expect(pickup).toContain("Ask before reading unrelated or sensitive paths");
      expect(pickup).toContain("Do not automatically invoke a suggested skill");
    }
  });
});

test("both installed bootstraps keep authorized work moving across checkpoints without widening permission", () => {
  withInstalledInstructions((home, source) => {
    for (const bootstrap of [".claude/CLAUDE.md", ".pi/agent/AGENTS.md"]) {
      const entry = join(home, bootstrap);
      expect(realpathSync(entry)).toBe(realpathSync(join(source, "baseline.md")));
      const instructions = readFileSync(entry, "utf8");
      const continuation = instructions.match(/## Keep work moving\n([\s\S]*?)(?=\n## |$)/)?.[1] ?? "";
      for (const requirement of [
        "Continue the current authorized task until it is complete",
        "user approval, decision, or required manual action",
        "progress update, worklog checkpoint, or completed workflow step is not a stopping point",
        "take the next safe, authorized step instead of waiting for another “continue”",
        "same still-valid scope",
        "changed scope or evidence invalidates that approval",
        "workflow requires fresh approval",
        "Investigate failures within the authorized scope",
        "concrete blocker and the smallest user action needed",
        "explicit pause, cancellation, or handoff",
        "Do not bypass permissions, execution limits, native transition steps, or approval gates",
        "Do not start another task",
      ]) expect(continuation).toContain(requirement);
      expect(instructions).toContain("Do not stage, commit, push, or deliver unless the current request explicitly authorizes that action");
      expect(instructions).toContain("Never clean a worktree merely because work ends");
      expect(instructions).toContain("Do not change the installed AI configuration while testing a replacement package");
    }
  });
});

test("both installed bootstraps load one STE-inspired rule for every prose surface", () => {
  withInstalledInstructions((home, source) => {
    for (const bootstrap of [".claude/CLAUDE.md", ".pi/agent/AGENTS.md"]) {
      const entry = realpathSync(join(home, bootstrap));
      expect(entry).toBe(realpathSync(join(source, "baseline.md")));
      const instructions = readFileSync(entry, "utf8");
      expect(instructions).toContain("Before writing prose, read and follow `writing.md`");
      const trigger = instructions.match(/- `writing\.md`: ([^\n]+)/)?.[1] ?? "";
      for (const surface of ["replies", "documents", "comments", "commit messages"]) {
        expect(trigger).toContain(surface);
      }
      const rulePath = resolve(dirname(entry), "rules/writing.md");
      expect(realpathSync(rulePath)).toBe(realpathSync(join(source, "rules/writing.md")));
      const writing = readFileSync(rulePath, "utf8");
      for (const requirement of ["Simplified Technical English", "practical defaults", "familiar, precise words",
        "simple tenses", "full forms", "semicolons", "editing targets, not hard gates",
        "Before sending a reply or writing prose", "conditions, uncertainty, or evidence", "not automatic enforcement"]) {
        expect(writing).toContain(requirement);
      }
      expect(writing).toContain("Do not rename identifiers");
      expect(writing).toContain("technical meaning");
    }
  });
});

test("installed code and worklog skills return from checkpoints to the shared continuation policy", () => {
  withInstalledInstructions((home, source) => {
    for (const harness of harnesses) {
      for (const skill of ["code", "worklog"]) {
        const entry = realpathSync(join(home, harness, "skills", skill, "SKILL.md"));
        const caller = readFileSync(entry, "utf8");
        const reference = caller.match(/\[continuation policy\]\(([^)#]+)#keep-work-moving\)/);
        expect(reference).not.toBeNull();
        const policyPath = resolve(dirname(entry), reference![1]);
        expect(policyPath).toBe(realpathSync(join(source, "baseline.md")));
        expect(readFileSync(policyPath, "utf8")).toContain("## Keep work moving");
        expect(caller).toContain("next authorized step");
        expect(caller).not.toContain("## Keep work moving");
      }
      const worklog = readFileSync(join(home, harness, "skills/worklog/SKILL.md"), "utf8");
      expect(worklog).toContain("A logging failure does not block otherwise authorized work");
      expect(worklog).toContain("Never start it automatically");
      const code = readFileSync(join(home, harness, "skills/code/SKILL.md"), "utf8");
      expect(code).toContain("Do not stage, commit, push, merge, or publish by implication");
      expect(code).toContain("rejected and undecided findings are not repair scope");
    }
  });
});

test("installed change-review skills load one source-owned local and PR interaction protocol", () => {
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
      expect(caller).toContain("Do not repair PR findings in this workflow");
      for (const requirement of ["publication_only", "PR reports never authorize repairs", "one Publish button below the document",
        "verbatim", "There is no separate Preview step", "edit publication drafts"]) {
        expect(protocol).toContain(requirement);
      }
    }
  });
});

test("document writing shares the same rule without replacing context and decision conventions", () => {
  withInstalledInstructions((home, source) => {
    for (const bootstrap of [".claude/CLAUDE.md", ".pi/agent/AGENTS.md"]) {
      const entry = realpathSync(join(home, bootstrap));
      const instructions = readFileSync(entry, "utf8");
      const trigger = instructions.match(/- `writing\.md`: ([^\n]+)/)?.[1] ?? "";
      expect(trigger).toContain("documents");
      expect(instructions).toContain("`documentation.md`: changing context documentation or durable decisions");
      const rulePath = resolve(dirname(entry), "rules/writing.md");
      expect(realpathSync(rulePath)).toBe(realpathSync(join(source, "rules/writing.md")));
      const rule = readFileSync(rulePath, "utf8");
      for (const requirement of ["problem, proposed approach, and practical effect", "order the reader needs",
        "concrete examples", "reader's question", "Do not force one outline", "conditions, uncertainty, or evidence"]) {
        expect(rule).toContain(requirement);
      }
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
