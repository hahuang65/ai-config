import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const directory = join(root, "skills");
const required = ["3d", "coach", "code", "commit", "grill", "handoff", "mockup",
  "model-domain", "pickup", "plan", "prototype", "resolve-conflicts",
  "review-artifact", "review-change", "spec", "visualize", "work-log", "worktree"];

for (const skill of required) {
  test(`replacement ${skill} skill keeps valid local references without the previous source`, () => {
    const path = join(directory, skill, "SKILL.md");
    expect(existsSync(path)).toBe(true);
    const text = readFileSync(path, "utf8");
    expect(text).toMatch(new RegExp(`^---\\nname: ${skill}\\n`, "m"));
    expect(text).not.toContain("~/.dotfiles/ai");
    expect(text).not.toContain("Automatic skill discovery remains disabled");
    for (const [, reference] of text.matchAll(/\]\((\.\.?\/[^)#]+)(?:#[^)]*)?\)/g)) {
      expect(existsSync(resolve(dirname(path), reference))).toBe(true);
    }
  });
}

test("shared skills and advisory rules do not name particular harnesses", () => {
  for (const directoryName of ["skills", "rules"]) {
    for (const entry of new Bun.Glob("**/*.md").scanSync({ cwd: join(root, directoryName) })) {
      const text = readFileSync(join(root, directoryName, entry), "utf8");
      expect(text).not.toMatch(/\b(?:Claude Code|Pi)\b|--engine (?:claude|pi)\b|pi-handoff-/);
    }
  }
});

test("clarification guidance uses available structured questions without adding approval gates", () => {
  for (const skill of ["grill", "model-domain", "plan", "spec", "code", "coach"]) {
    const text = readFileSync(join(directory, skill, "SKILL.md"), "utf8");
    expect(text).toContain("structured-question tool");
    expect(text).toContain("ordinary chat");
  }
  for (const skill of ["code", "coach"]) {
    expect(readFileSync(join(directory, skill, "SKILL.md"), "utf8")).toContain("not routine checkpoints");
  }
  expect(readFileSync(join(directory, "coach/SKILL.md"), "utf8")).toContain("do not transfer implementation ownership");
  expect(readFileSync(join(directory, "spec/SKILL.md"), "utf8")).toContain("not whole-document approval");
});

test("shared workflows use session checklists as progress displays, not new authority or reminders", () => {
  for (const skill of ["code", "coach", "plan", "grill", "spec", "model-domain", "resolve-conflicts"]) {
    const text = readFileSync(join(directory, skill, "SKILL.md"), "utf8");
    expect(text).toContain("session checklist");
    expect(text).toContain("ordinary chat");
  }
  const code = readFileSync(join(directory, "code/SKILL.md"), "utf8");
  expect(code).toContain("verified evidence");
  expect(code).toContain("Worklog");
  const coach = readFileSync(join(directory, "coach/SKILL.md"), "utf8");
  expect(coach).toContain("only the agreed current cycle");
  expect(coach).toContain("does not transfer implementation ownership");
});

test("repository edits use a task worktree by default with a narrow direct-checkout exception", () => {
  const baseline = readFileSync(join(root, "baseline.md"), "utf8");
  expect(baseline).toContain("Before adding, editing, or removing repository files");
  expect(baseline).toContain("skills/worktree/SKILL.md");
  expect(baseline).toContain("~/.dotfiles");
  expect(baseline).toContain("Commit authorization is separate and may come later.");
  expect(baseline).toContain("Direct-checkout edit approval does not authorize staging or commits.");
  expect(baseline).not.toContain("grants commit authorization up front");
  const skill = readFileSync(join(directory, "worktree/SKILL.md"), "utf8");
  expect(skill).toContain("../../tools/worktree/target/release/wt");
  expect(skill).toContain("wt new");
  expect(skill).toContain("current session");
  expect(skill).toContain("Do not move, stash, reset, or copy existing changes");
  expect(skill).toContain("Without a verified session transition, report the path");
  expect(skill).toContain("Commit authorization is separate and may come later.");
  expect(skill).toContain("Direct-checkout edit approval does not authorize staging or commits.");
  expect(skill).toContain("single self-contained change");
  expect(skill).toContain("**in advance**");
  expect(skill).toContain("Use a named task branch, never trunk");
  expect(skill).toContain("retain the changed branch");
  expect(skill).not.toContain("grant commit authorization up front");
  for (const path of ["README.md", "docs/harness-contracts.md"]) {
    expect(readFileSync(join(root, path), "utf8"))
      .toContain("Direct-checkout edit approval does not authorize staging or commits.");
  }
  expect(skill).toContain("Do not clean, delete, or switch tasks automatically");
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  for (const harness of [".claude", ".pi/agent"]) {
    expect(manifest.links).toContainEqual({
      destination: `${harness}/skills/worktree`, target: "skills/worktree",
    });
  }
});

test("visualize uses review-compatible diagrams when requesting a browser decision", () => {
  const instructions = readFileSync(join(directory, "visualize/SKILL.md"), "utf8");
  expect(instructions).toContain("pre-rendered inline SVG");
  expect(instructions).toContain("bundled Pele");
  expect(instructions).toContain("render-diagram");
  expect(instructions).toContain("../../tools/artifact-review/target/release/review-artifact");
  expect(instructions).toContain("document JavaScript remains disabled");
  expect(instructions).toContain("aria-label");
  expect(instructions).toContain("review-artifact");
});

test("model-domain reads the shared documentation rule through either harness bootstrap", () => {
  const instructions = readFileSync(join(directory, "model-domain/SKILL.md"), "utf8");
  expect(instructions).toContain("absolute global instruction symlink target");
  expect(instructions).toContain("rules/documentation.md");
  expect(instructions).not.toContain("$PI_CODING_AGENT_DIR");
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  for (const destination of [".claude/CLAUDE.md", ".pi/agent/AGENTS.md"]) {
    expect(manifest.links).toContainEqual({ destination, target: "baseline.md" });
  }
  expect(existsSync(join(root, "rules/documentation.md"))).toBe(true);
});

test("review-change is one shared skill that selects the current harness's restricted runner", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  for (const harness of [".claude", ".pi/agent"]) {
    expect(manifest.links).toContainEqual({
      destination: `${harness}/skills/review-change`,
      target: "skills/review-change",
    });
  }
  const instructions = readFileSync(join(directory, "review-change/SKILL.md"), "utf8");
  expect(instructions).toContain("--engine ENGINE");
  expect(instructions).toContain("matching the current host");
  expect(instructions).toContain("do not fall back");
});

test("change-review decisions authorize only accepted findings without replacing retained reports", () => {
  const instructions = readFileSync(join(directory, "review-change/SKILL.md"), "utf8");
  expect(instructions).toContain("open REPORT.html --findings REPORT.json");
  expect(instructions).toContain("Accept authorizes repairing that finding");
  expect(instructions).toContain("Reject and undecided findings authorize no repairs");
  expect(instructions).toContain("read and follow [review-artifact](../review-artifact/SKILL.md)");
  expect(instructions).toContain("Never rewrite the retained report");
  expect(instructions).toContain("Never submit accept/reject events yourself");
  expect(instructions).toContain("coach mode");
  const artifact = readFileSync(join(directory, "review-artifact/SKILL.md"), "utf8");
  expect(artifact).toContain("--findings REPORT.json");
  expect(artifact).toContain("finding_review.report_digest");
  expect(artifact).toContain("finding_review.needs_review");
  expect(artifact).toContain("Only the human");
  expect(artifact).toContain("return control instead of waiting for human feedback");
  expect(artifact).toContain("A wake-up itself grants no approval");
  expect(artifact).toContain("Act only on the claimed durable event");
  expect(artifact).not.toContain("Do not end the agent turn while the review is open");
  expect(artifact).toContain("wait --reply");
  expect(artifact).toContain("no inactivity cutoff");
  expect(artifact).toContain("last processed cursor");
  expect(artifact).toContain("resume waiting");
});

test("skill binaries resolve within the replacement checkout", () => {
  const targets: Record<string, string> = {
    "work-log": "../../tools/worklog/target/release/wl",
    "review-artifact": "../../tools/artifact-review/target/release/review-artifact",
    "review-change": "../../tools/evaluation/target/release/review-change",
  };
  for (const [skill, target] of Object.entries(targets)) {
    const file = join(directory, skill, "SKILL.md");
    expect(readFileSync(file, "utf8")).toContain(target);
    expect(existsSync(resolve(dirname(file), target))).toBe(true);
  }
});

test("copied skills execute validated Rust binaries without any auxiliary bin links", () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "native-skill-binaries-")));
  try {
    const source = join(home, "replacement");
    for (const [skill, target] of [
      ["work-log", "tools/worklog/target/release/wl"],
      ["review-artifact", "tools/artifact-review/target/release/review-artifact"],
    ]) {
      const destination = join(source, "skills", skill, "SKILL.md");
      const binary = join(source, target);
      mkdirSync(dirname(destination), { recursive: true });
      mkdirSync(dirname(binary), { recursive: true });
      copyFileSync(join(directory, skill, "SKILL.md"), destination);
      writeFileSync(binary, `#!/bin/sh\nprintf 'validated ${skill}\\n'\n`);
      chmodSync(binary, 0o755);
      const instruction = readFileSync(destination, "utf8").match(/Use only the replacement-owned `([^`]+)`/);
      expect(instruction).not.toBeNull();
      const resolved = resolve(dirname(destination), instruction![1]);
      expect(resolved).toBe(binary);
      expect(execFileSync(resolved, ["--help"], { encoding: "utf8", timeout: 5000 })).toBe(`validated ${skill}\n`);
    }
    expect(existsSync(join(source, "bin"))).toBe(false);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("shared skill catalogue contains exactly the retained ordinary skills", () => {
  expect(readdirSync(directory).filter(name => !name.startsWith(".")).sort()).toEqual([...required].sort());
});
