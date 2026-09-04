import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const memoryProtocol = source("skills/shared/references/agentmemory.md");

describe("optional historical memory protocol", () => {
  test("makes canonical sources authoritative and memory optional", () => {
    expect(memoryProtocol).toContain("A recalled record is a lead to verify");
    expect(memoryProtocol).toContain("continue normally when agentmemory");
    expect(memoryProtocol).toContain("Never use memory to establish approval");
  });

  test("requires a project-filtered recall path", () => {
    expect(memoryProtocol).toContain("`memory_timeline`");
    expect(memoryProtocol).toContain("normalized Git origin");
    expect(memoryProtocol).toContain("Do not use unfiltered smart search");
  });

  test("requires capture off before a selected Confluence destination is read", () => {
    expect(memoryProtocol).toContain("set capture to `off` before the first Confluence read");
    expect(source("skills/shared/references/domain-documentation.md")).toContain(
      "disable optional historical-memory capture before the first Confluence read",
    );
  });

  test("does not duplicate canonical artifacts in memory", () => {
    expect(memoryProtocol).toContain("Do not save copies of context documentation");
  });
});

describe("workflow integration", () => {
  test("model-domain verifies optional historical terminology after current documentation", () => {
    const skill = source("skills/model-domain/SKILL.md");
    expect(skill).toContain("optional historical memory");
    expect(skill).toContain("After reading the current context documentation");
  });

  test("spec checks optional history only after current sources", () => {
    const skill = source("skills/spec/SKILL.md");
    expect(skill).toContain("optional historical memory");
    expect(skill).toContain("After those current sources");
  });

  test("implementation checks known historical problems once before the first slice", () => {
    for (const path of ["skills/code/SKILL.md", "skills/coach/SKILL.md"]) {
      const skill = source(path);
      expect(skill).toContain("once before the first slice");
      expect(skill).toContain("optional historical memory");
    }
  });

  test("pickup augments a primary handoff with one targeted search and confirms a session fallback", () => {
    const skill = source("skills/pickup/SKILL.md");
    expect(skill).toContain("After reading the selected handoff");
    expect(skill).toContain("search optional historical memory once");
    expect(skill).toContain("Optional agentmemory fallback");
    expect(skill).toContain("ask for confirmation before reading session history");
    expect(skill).toContain("`memory_timeline`");
    expect(skill).toContain("The `/tmp/` handoff remains primary");
  });

  test("documents managed Claude capture without upstream hooks", () => {
    const readme = source("README.md");
    expect(readme).toContain("Repository-managed hooks add automatic capture");
    expect(readme).toContain("Do not run `agentmemory connect claude-code --with-hooks`");
  });

  test("documents automatic repair after agentmemory reconnects pi", () => {
    const readme = source("README.md");
    expect(readme).toContain("safe to run `agentmemory connect pi`");
    expect(readme).toContain("restores the managed links and queues one automatic pi reload");
  });

  test("the main installer delegates portable agentmemory service setup", () => {
    const installer = source("install.sh");
    const readme = source("README.md");
    expect(installer).toContain("agentmemory/install.sh");
    expect(readme).toContain("~/.agentmemory/iii-config.yaml");
    expect(readme).toContain("~/.config/systemd/user/agentmemory.service");
    expect(readme).toContain("~/Library/LaunchAgents/dev.agentmemory.plist");
  });

  test("tasks and review do not gain routine memory searches", () => {
    expect(source("skills/todo/SKILL.md")).not.toContain("agentmemory.md");
    expect(source("skills/review-change/SKILL.md")).not.toContain("agentmemory.md");
  });
});
