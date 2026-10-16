import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ruleNames = ["a5", "cli-ergonomics", "coding-style", "documentation", "git-commit", "html-routing", "mise", "performance", "security", "testing"];
const instructions = [".claude/CLAUDE.md", ".pi/agent/AGENTS.md"];

function withDisposableInstallation(check: (home: string) => void) {
  const home = mkdtempSync(join(tmpdir(), "native-bootstrap-"));
  try {
    const source = join(home, "replacement");
    const replacement = fileURLToPath(new URL("../", import.meta.url));
    mkdirSync(source, { recursive: true });
    cpSync(join(replacement, "baseline.md"), join(source, "baseline.md"));
    cpSync(join(replacement, "rules"), join(source, "rules"), { recursive: true });
    cpSync(join(replacement, "skills/worktree"), join(source, "skills/worktree"), { recursive: true });
    mkdirSync(join(source, "harnesses/claude"), { recursive: true });
    cpSync(join(replacement, "harnesses/claude/harness-rules.md"),
      join(source, "harnesses/claude/harness-rules.md"));
    for (const name of instructions) {
      const link = join(home, name);
      const parent = dirname(link);
      mkdirSync(parent, { recursive: true });
      symlinkSync(join(source, "baseline.md"), link);
    }
    check(home);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("authoring instructions and context describe the actual root package paths", () => {
  const source = fileURLToPath(new URL("../", import.meta.url));
  for (const document of ["AGENTS.md", "CONTEXT.md"]) {
    const instructions = readFileSync(join(source, document), "utf8");
    expect(instructions).not.toContain("native/");
    for (const resource of ["manifest.json", "baseline.md", "skills/", "harnesses/pi/", "harnesses/claude/"]) {
      expect(instructions).toContain(resource);
      expect(existsSync(join(source, resource))).toBe(true);
    }
  }
});

test("current documentation retains the review risk without temporary cutover planning files", () => {
  const source = fileURLToPath(new URL("../", import.meta.url));
  for (const file of ["docs/minimal-adoption-feasibility.md",
    "docs/adr/0040-evaluate-by-switching-configuration-sources.md"]) {
    expect(existsSync(join(source, file))).toBe(false);
  }
  const context = readFileSync(join(source, "CONTEXT.md"), "utf8");
  expect(context).not.toContain("0040-evaluate-by-switching-configuration-sources.md");
  expect(context).toContain("current live source");
  expect(context).not.toContain("inactive canonical configuration source");
  expect(readFileSync(join(source, "AGENTS.md"), "utf8"))
    .toContain("current installation links to this checkout");
  const cli = readFileSync(join(source, "docs/review-change-cli.md"), "utf8");
  expect(cli).toContain("same-user agent");
  expect(cli).toContain("explicit human confirmation");
  expect(cli).toContain("simulate a browser gesture");
  const readme = readFileSync(join(source, "README.md"), "utf8");
  expect(readme).toContain("currently installed");
  expect(readme).not.toContain("It is not yet installed");
  expect(readme).toContain("separate approval for a live home");
});

test("authoring policy requires a human publication decision without prescribing a terminal", () => {
  const source = fileURLToPath(new URL("../", import.meta.url));
  const policy = readFileSync(join(source, "AGENTS.md"), "utf8");
  expect(policy).toContain("Review publication requires explicit human confirmation of the exact publication preview");
  expect(policy).toContain("Repair Accept/Reject decisions never authorize publication");
  expect(policy).not.toContain("human-confirmed in a real terminal");
});

test("current installation guidance names the build-and-install entry point", () => {
  const source = fileURLToPath(new URL("../", import.meta.url));
  for (const document of ["README.md", "AGENTS.md", "CONTEXT.md"]) {
    expect(readFileSync(join(source, document), "utf8")).toContain("./install.sh");
  }
  const makefile = readFileSync(join(source, "Makefile"), "utf8");
  expect(makefile).toContain("./install.sh");
});

test("Claude's shell guidance is available without the former harness directory", () => {
  withDisposableInstallation((home) => {
    const link = join(home, ".claude/CLAUDE.md");
    const baseline = readFileSync(link, "utf8");
    expect(baseline).toContain("harnesses/claude/harness-rules.md");
    const target = readlinkSync(link);
    expect(isAbsolute(target)).toBe(true);
    const path = resolve(dirname(target), "harnesses/claude/harness-rules.md");
    expect(path.startsWith(process.cwd())).toBe(false);
    expect(readFileSync(path, "utf8")).toContain("cannot be statically analyzed");
  });
});

for (const name of instructions) {
  test(`${name} has the same replacement-owned bootstrap and on-demand rules without the old AI source`, () => {
    withDisposableInstallation((home) => {
      const link = join(home, name);
      const baseline = readFileSync(link, "utf8");
      expect(baseline).toContain("rules");
      expect(baseline).toContain("skills/worktree/SKILL.md");
      expect(baseline).not.toContain(".dotfiles/ai");
      expect(baseline).not.toContain("pi-minimal");
      const target = readlinkSync(link);
      expect(isAbsolute(target)).toBe(true);
      const worktreeSkill = resolve(dirname(target), "skills/worktree/SKILL.md");
      expect(readFileSync(worktreeSkill, "utf8")).toContain("Before the first repository write");
      const rules = resolve(dirname(target), "rules");
      expect(rules.startsWith(process.cwd())).toBe(false);
      for (const rule of ruleNames) {
        const path = join(rules, `${rule}.md`);
        expect(existsSync(path)).toBe(true);
        expect(readFileSync(path, "utf8")).not.toContain(".dotfiles/ai");
      }
    });
  });
}
