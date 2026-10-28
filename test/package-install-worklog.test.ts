import { expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installFixture, installerScenarioGuard } from "./fixtures/install-script";

const destination = ".pi/agent/extensions/worklog.ts";
const target = "harnesses/pi/worklog.bundle.ts";
const skillRoots = [".claude/skills", ".pi/agent/skills"];

function previousSkillPackage(source: string) {
  const manifestFile = join(source, "manifest.json");
  const catalogueFile = join(source, "tools/install/manifest.jq");
  const skillFile = join(source, "skills/worklog/SKILL.md");
  const manifestText = readFileSync(manifestFile, "utf8");
  const catalogue = readFileSync(catalogueFile, "utf8");
  const skill = readFileSync(skillFile, "utf8");
  const manifest = JSON.parse(manifestText);
  for (const link of manifest.links) {
    if (link.target !== "skills/worklog") continue;
    link.destination = link.destination.replace(/\/worklog$/, "/work-log");
    link.target = "skills/work-log";
  }
  renameSync(join(source, "skills/worklog"), join(source, "skills/work-log"));
  writeFileSync(join(source, "skills/work-log/SKILL.md"), skill.replace("name: worklog\n", "name: work-log\n"));
  writeFileSync(manifestFile, JSON.stringify(manifest));
  writeFileSync(catalogueFile, catalogue.replace('"visualize", "worklog", "worktree"', '"visualize", "work-log", "worktree"'));
  return () => {
    renameSync(join(source, "skills/work-log"), join(source, "skills/worklog"));
    writeFileSync(skillFile, skill);
    writeFileSync(manifestFile, manifestText);
    writeFileSync(catalogueFile, catalogue);
  };
}

test("recorded Worklog skill upgrades expose only worklog and preserve private data", () => {
  const setup = installFixture();
  try {
    const upgradeSource = previousSkillPackage(setup.source);
    const initial = setup.run();
    expect(initial.status, initial.stderr).toBe(0);
    for (const root of skillRoots) expect(readlinkSync(join(setup.home, root, "work-log"))).toBe(join(setup.source, "skills/work-log"));
    const data = join(setup.home, ".worklog/personal-data");
    mkdirSync(dirname(data), { recursive: true });
    writeFileSync(data, "UNCHANGED_WORKLOG_DATA\n");
    upgradeSource();
    const upgraded = setup.run();
    expect(upgraded.status, upgraded.stderr).toBe(0);
    for (const root of skillRoots) {
      expect(lstatSync(join(setup.home, root, "work-log"), { throwIfNoEntry: false })).toBeUndefined();
      expect(readlinkSync(join(setup.home, root, "worklog"))).toBe(join(setup.source, "skills/worklog"));
    }
    expect(readFileSync(data, "utf8")).toBe("UNCHANGED_WORKLOG_DATA\n");
    const record = JSON.parse(readFileSync(join(setup.home, ".local/state/ai-config/installation.json"), "utf8"));
    expect(record.links.filter((link: { destination: string }) => /\/skills\/work-?log$/.test(link.destination)))
      .toEqual(skillRoots.map(root => ({ destination: `${root}/worklog`, target: "skills/worklog" })));
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("a failed Worklog rename restores both old owned links and their ownership record", () => {
  const setup = installFixture();
  try {
    const upgradeSource = previousSkillPackage(setup.source);
    const initial = setup.run();
    expect(initial.status, initial.stderr).toBe(0);
    const recordFile = join(setup.home, ".local/state/ai-config/installation.json");
    const record = readFileSync(recordFile, "utf8");
    upgradeSource();
    writeFileSync(join(setup.bin, "mv"), '#!/bin/bash\nif [[ $1 == --version ]]; then exec "$REAL_MV" "$@"; fi\nif [[ ${!#} == "$HOME/.pi/agent/skills/worklog" ]]; then exit 23; fi\nexec "$REAL_MV" "$@"\n', { mode: 0o755 });
    const result = setup.run([], { REAL_MV: Bun.which("mv")! });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("prior links and settings restored");
    expect(readFileSync(recordFile, "utf8")).toBe(record);
    for (const root of skillRoots) {
      expect(readlinkSync(join(setup.home, root, "work-log"))).toBe(join(setup.source, "skills/work-log"));
      expect(lstatSync(join(setup.home, root, "worklog"), { throwIfNoEntry: false })).toBeUndefined();
    }
    expect(existsSync(join(setup.home, ".local/state/ai-config/install.lock.d"))).toBe(false);
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("a personal work-log skill remains unowned alongside the canonical worklog skill", () => {
  const setup = installFixture();
  try {
    const personal = "---\nname: work-log\ndescription: Personal resource.\n---\nKeep this personal skill.\n";
    for (const root of skillRoots) {
      const file = join(setup.home, root, "work-log/SKILL.md");
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, personal);
    }
    const installed = setup.run();
    expect(installed.status, installed.stderr).toBe(0);
    for (const root of skillRoots) {
      expect(readFileSync(join(setup.home, root, "work-log/SKILL.md"), "utf8")).toBe(personal);
      expect(lstatSync(join(setup.home, root, "work-log")).isDirectory()).toBe(true);
      expect(readlinkSync(join(setup.home, root, "worklog"))).toBe(join(setup.source, "skills/worklog"));
    }
    const record = JSON.parse(readFileSync(join(setup.home, ".local/state/ai-config/installation.json"), "utf8"));
    expect(record.links.some((link: { destination: string }) => link.destination.endsWith("/skills/work-log"))).toBe(false);
  } finally { setup.clean(); }
}, installerScenarioGuard(1));

for (const root of skillRoots) {
  test(`an unowned ${root}/worklog refuses upgrade without removing the old owned links`, () => {
    const setup = installFixture();
    try {
      const upgradeSource = previousSkillPackage(setup.source);
      const initial = setup.run();
      expect(initial.status, initial.stderr).toBe(0);
      upgradeSource();
      const personal = join(setup.home, root, "worklog/SKILL.md");
      mkdirSync(dirname(personal), { recursive: true });
      writeFileSync(personal, "Personal Worklog skill.\n");
      const recordFile = join(setup.home, ".local/state/ai-config/installation.json");
      const record = readFileSync(recordFile, "utf8");
      const result = setup.run();
      expect(result.status).not.toBe(0);
      expect(readFileSync(personal, "utf8")).toBe("Personal Worklog skill.\n");
      expect(readFileSync(recordFile, "utf8")).toBe(record);
      for (const original of skillRoots) {
        expect(readlinkSync(join(setup.home, original, "work-log"))).toBe(join(setup.source, "skills/work-log"));
      }
    } finally { setup.clean(); }
  }, installerScenarioGuard(2));
}

test("recorded upgrades add Worklog capture without changing personal settings or extensions", () => {
  const setup = installFixture();
  try {
    const initial = setup.run();
    expect(initial.status, initial.stderr).toBe(0);
    const recordFile = join(setup.home, ".local/state/ai-config/installation.json");
    const record = JSON.parse(readFileSync(recordFile, "utf8"));
    expect(record.links).toContainEqual({ destination, target });
    record.links = record.links.filter((link: { destination: string }) => link.destination !== destination);
    writeFileSync(recordFile, JSON.stringify(record));
    unlinkSync(join(setup.home, destination));
    const settingsFile = join(setup.home, ".pi/agent/settings.json");
    const settings = { ...JSON.parse(readFileSync(settingsFile, "utf8")), defaultModel: "personal",
      defaultTools: ["read"], extensions: ["./extensions/personal.ts"] };
    writeFileSync(settingsFile, JSON.stringify(settings));
    const personal = join(setup.home, ".pi/agent/extensions/personal.ts");
    writeFileSync(personal, "export default function () {}\n");
    const result = setup.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(join(setup.home, destination))).toBe(join(setup.source, target));
    expect(JSON.parse(readFileSync(settingsFile, "utf8"))).toEqual(settings);
    expect(readFileSync(personal, "utf8")).toBe("export default function () {}\n");
    expect(JSON.parse(readFileSync(recordFile, "utf8")).links).toContainEqual({ destination, target });
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("the installer refuses an unowned matching Worklog extension instead of adopting it", () => {
  const setup = installFixture();
  try {
    const file = join(setup.home, destination);
    const content = readFileSync(join(setup.source, target), "utf8");
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
    expect(setup.run().status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe(content);
    expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
  } finally { setup.clean(); }
}, installerScenarioGuard(1));
