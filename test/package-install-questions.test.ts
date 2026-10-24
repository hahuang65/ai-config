import { expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFixture, installerScenarioGuard } from "./fixtures/install-script";

test("fresh installation explicitly allows Claude questions without widening other permissions", () => {
  const setup = installFixture();
  try {
    mkdirSync(join(setup.home, ".claude"), { recursive: true });
    const file = join(setup.home, ".claude/settings.json");
    writeFileSync(file, JSON.stringify({ model: "personal", permissions: {
      allow: ["Read(personal)"], deny: ["Bash(personal-protected *)"], ask: ["Bash(personal-confirm *)"],
    } }));
    const result = setup.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const settings = JSON.parse(readFileSync(file, "utf8"));
    expect(settings.permissions.allow).toContain("AskUserQuestion");
    expect(settings.permissions.deny).not.toContain("AskUserQuestion");
    for (const denied of ["EnterPlanMode", "ExitPlanMode", "SendMessage", "CronCreate", "Bash(git push)"]) {
      expect(settings.permissions.deny).toContain(denied);
    }
    expect(settings.model).toBe("personal");
    expect(settings.permissions.allow).toContain("Read(personal)");
    expect(settings.permissions.deny).toContain("Bash(personal-protected *)");
    expect(settings.permissions.ask).toContain("Bash(personal-confirm *)");
  } finally { setup.clean(); }
}, installerScenarioGuard(1));

function previousQuestionPolicy(source: string) {
  const manifestFile = join(source, "manifest.json");
  const permissionsFile = join(source, "tools/install/permissions.json");
  const manifestText = readFileSync(manifestFile, "utf8");
  const permissionsText = readFileSync(permissionsFile, "utf8");
  const manifest = JSON.parse(manifestText);
  manifest.settings = manifest.settings.filter((setting: { value: unknown }) => setting.value !== "AskUserQuestion");
  manifest.settings.push({ destination: ".claude/settings.json", path: ["permissions", "deny"],
    mode: "array_entry", value: "AskUserQuestion" });
  const permissions = JSON.parse(permissionsText);
  permissions.allow = permissions.allow.filter((value: string) => value !== "AskUserQuestion");
  permissions.deny.push("AskUserQuestion");
  writeFileSync(manifestFile, JSON.stringify(manifest));
  writeFileSync(permissionsFile, JSON.stringify(permissions));
  return () => { writeFileSync(manifestFile, manifestText); writeFileSync(permissionsFile, permissionsText); };
}

test("upgrading retires only the owned question denial and records the explicit allowance", () => {
  const setup = installFixture();
  try {
    const restore = previousQuestionPolicy(setup.source);
    const initial = setup.run();
    expect({ status: initial.status, stderr: initial.stderr }).toEqual({ status: 0, stderr: "" });
    const file = join(setup.home, ".claude/settings.json");
    const before = JSON.parse(readFileSync(file, "utf8"));
    expect(before.permissions.deny).toContain("AskUserQuestion");
    before.model = "personal";
    before.permissions.allow.push("Read(personal)");
    before.permissions.deny.push("Bash(personal-protected *)");
    writeFileSync(file, JSON.stringify(before));
    const piFile = join(setup.home, ".pi/agent/settings.json");
    const piBefore = readFileSync(piFile, "utf8");
    restore();
    const result = setup.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const after = JSON.parse(readFileSync(file, "utf8"));
    for (const key of ["allow", "deny", "ask", "additionalDirectories"]) {
      const expected = before.permissions[key].filter((value: string) => value !== "AskUserQuestion");
      if (key === "allow") expected.push("AskUserQuestion");
      expect([...after.permissions[key]].sort()).toEqual(expected.sort());
    }
    expect(after.model).toBe("personal");
    expect(readFileSync(piFile, "utf8")).toBe(piBefore);
    const record = JSON.parse(readFileSync(join(setup.home, ".local/state/ai-config/installation.json"), "utf8"));
    expect(record.settings.filter((setting: { value: unknown }) => setting.value === "AskUserQuestion"))
      .toEqual([{ destination: ".claude/settings.json", path: ["permissions", "allow"],
        mode: "array_entry", value: "AskUserQuestion" }]);
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("installation preserves an independently configured personal question denial", () => {
  const setup = installFixture();
  try {
    mkdirSync(join(setup.home, ".claude"), { recursive: true });
    const file = join(setup.home, ".claude/settings.json");
    writeFileSync(file, JSON.stringify({ permissions: { deny: ["AskUserQuestion"] } }));
    const result = setup.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    const settings = JSON.parse(readFileSync(file, "utf8"));
    expect(settings.permissions.allow).toContain("AskUserQuestion");
    expect(settings.permissions.deny).toContain("AskUserQuestion");
    const record = JSON.parse(readFileSync(join(setup.home, ".local/state/ai-config/installation.json"), "utf8"));
    expect(record.settings.some((setting: { path: string[]; value: unknown }) =>
      setting.path[1] === "deny" && setting.value === "AskUserQuestion")).toBe(false);
  } finally { setup.clean(); }
}, installerScenarioGuard(1));
