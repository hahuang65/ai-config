import { expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFixture } from "./fixtures/install-script";

const recordName = ".local/state/ai-config/installation.json";

test("shell upgrades version-one ownership and repairs missing owned links and settings", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const record = join(setup.home, recordName);
    const old = JSON.parse(readFileSync(record, "utf8"));
    writeFileSync(record, JSON.stringify({ version: 1, source: old.source, links: old.links }));
    rmSync(join(setup.home, ".claude/CLAUDE.md"));
    writeFileSync(join(setup.home, ".claude/settings.json"), '{"model":"personal"}');
    rmSync(join(setup.home, ".pi/agent/settings.json"));
    const result = setup.run();
    expect(result.status, result.stderr).toBe(0);
    expect(readlinkSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(join(setup.source, "baseline.md"));
    expect(JSON.parse(readFileSync(record, "utf8")).version).toBe(2);
    expect(JSON.parse(readFileSync(join(setup.home, ".claude/settings.json"), "utf8")))
      .toMatchObject({ model: "personal", theme: "custom:catppuccin-mocha" });
    expect(JSON.parse(readFileSync(join(setup.home, ".pi/agent/settings.json"), "utf8")).theme).toBe("catppuccin-mocha");
  } finally { setup.clean(); }
}, 30_000);

test("shell preserves corrupt and unknown ownership records without changing either harness", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const record = join(setup.home, recordName);
    const original = JSON.parse(readFileSync(record, "utf8"));
    const settings = [".claude/settings.json", ".pi/agent/settings.json"].map(path => join(setup.home, path));
    const before = settings.map(path => readFileSync(path, "utf8"));
    for (const invalid of ["not json", "{}", JSON.stringify({ ...original, version: 99 }),
      JSON.stringify({ ...original, "future-ownership": { settings: true } })]) {
      writeFileSync(record, invalid);
      expect(setup.run().status).toBe(1);
      expect(readFileSync(record, "utf8")).toBe(invalid);
      expect(settings.map(path => readFileSync(path, "utf8"))).toEqual(before);
      for (const path of [".claude/CLAUDE.md", ".pi/agent/AGENTS.md"]) {
        expect(readlinkSync(join(setup.home, path))).toBe(join(setup.source, "baseline.md"));
      }
    }
  } finally { setup.clean(); }
}, 30_000);

test("shell refuses unrecorded same-source links and does not normalize modified owned targets", () => {
  const setup = installFixture();
  try {
    const link = join(setup.home, ".claude/CLAUDE.md");
    mkdirSync(join(setup.home, ".claude"), { recursive: true });
    symlinkSync(join(setup.source, "baseline.md"), link);
    expect(setup.run().status).toBe(1);
    expect(readlinkSync(link)).toBe(join(setup.source, "baseline.md"));
    rmSync(link);
    expect(setup.run().status).toBe(0);
    const record = readFileSync(join(setup.home, recordName), "utf8");
    for (const changed of [`${setup.source}/./baseline.md`, `${setup.source}/baseline.md/`, "/missing/foreign"]) {
      rmSync(link);
      symlinkSync(changed, link);
      expect(setup.run().status).toBe(1);
      expect(readlinkSync(link)).toBe(changed);
      expect(readFileSync(join(setup.home, recordName), "utf8")).toBe(record);
      expect(readlinkSync(join(setup.home, ".pi/agent/AGENTS.md"))).toBe(join(setup.source, "baseline.md"));
    }
  } finally { setup.clean(); }
}, 30_000);

test("shell rejects edited owned settings without logging or overwriting the native choice", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const record = readFileSync(join(setup.home, recordName), "utf8");
    for (const relative of [".claude/settings.json", ".pi/agent/settings.json"]) {
      const path = join(setup.home, relative);
      const original = readFileSync(path, "utf8");
      const changed = JSON.parse(original);
      changed.theme = "private-native-choice";
      const bytes = JSON.stringify(changed);
      writeFileSync(path, bytes);
      chmodSync(path, 0o640);
      const result = setup.run();
      expect(result.status).toBe(1);
      expect(result.stdout + result.stderr).not.toContain("private-native-choice");
      expect(readFileSync(path, "utf8")).toBe(bytes);
      expect(statSync(path).mode & 0o777).toBe(0o640);
      expect(readFileSync(join(setup.home, recordName), "utf8")).toBe(record);
      expect(readlinkSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(join(setup.source, "baseline.md"));
      writeFileSync(path, original);
    }
  } finally { setup.clean(); }
}, 30_000);

test("repeat shell installation preserves settings bytes, inode, mode and private preferences", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const path = join(setup.home, ".pi/agent/settings.json");
    const personalized = '{"theme":"catppuccin-mocha", "defaultModel":"private-choice", "unknown":-0}\n';
    writeFileSync(path, personalized);
    chmodSync(path, 0o640);
    const inode = statSync(path).ino;
    expect(setup.run().status).toBe(0);
    expect(readFileSync(path, "utf8")).toBe(personalized);
    expect(statSync(path).ino).toBe(inode);
    expect(statSync(path).mode & 0o777).toBe(0o640);
    expect(readFileSync(join(setup.home, recordName), "utf8")).not.toContain("private-choice");
    expect(statSync(join(setup.home, ".local/state/ai-config")).mode & 0o777).toBe(0o700);
  } finally { setup.clean(); }
}, 30_000);
