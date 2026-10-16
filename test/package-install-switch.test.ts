import { expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installFixture } from "./fixtures/install-script";

function optionalResource(source: string, enabled: boolean) {
  const path = join(source, "manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  manifest.links = manifest.links.filter((link: { destination: string }) => link.destination !== ".pi/agent/extensions/obsolete.ts");
  if (enabled) {
    manifest.links.push({ destination: ".pi/agent/extensions/obsolete.ts", target: "harnesses/pi/obsolete.ts" });
    writeFileSync(join(source, "harnesses/pi/obsolete.ts"), "// fixture only\n");
  }
  writeFileSync(path, JSON.stringify(manifest));
}

test("shell preserves a modified obsolete link rather than pruning it during an upgrade", () => {
  const setup = installFixture();
  try {
    optionalResource(setup.source, true);
    expect(setup.run().status).toBe(0);
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const before = readFileSync(record, "utf8");
    optionalResource(setup.source, false);
    const link = join(setup.home, ".pi/agent/extensions/obsolete.ts");
    for (const changed of ["/missing/foreign", `${setup.source}/harnesses/pi/./obsolete.ts`]) {
      rmSync(link);
      symlinkSync(changed, link);
      const result = setup.run();
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Unowned or modified link");
      expect(readlinkSync(link)).toBe(changed);
      expect(readFileSync(record, "utf8")).toBe(before);
      expect(readlinkSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(join(setup.source, "baseline.md"));
    }
  } finally { setup.clean(); }
}, 30_000);

test("shell switches recorded sources repeatedly, preserves personal state and handles a removed source", () => {
  const setup = installFixture();
  try {
    optionalResource(setup.source, true);
    const next = join(setup.temporary, "next package");
    cpSync(setup.source, next, { recursive: true });
    optionalResource(next, false);
    const independent = join(setup.home, ".pi/agent/skills/independent");
    mkdirSync(dirname(independent), { recursive: true });
    symlinkSync("/missing/personal-skill", independent);
    const retained = [".claude/projects/history", ".pi/agent/sessions/history", ".pi/agent/trust.json",
      ".config/typesafe/independent", ".config/herdr/independent"];
    for (const path of retained) {
      mkdirSync(dirname(join(setup.home, path)), { recursive: true });
      writeFileSync(join(setup.home, path), "personal state");
    }
    const pi = join(setup.home, ".pi/agent/settings.json");
    writeFileSync(pi, '{"defaultModel":"personal","unknown":-0}');
    chmodSync(pi, 0o640);
    for (const source of [setup.source, setup.source, next, setup.source]) {
      const result = setup.runFrom(source);
      expect(result.status, result.stderr).toBe(0);
      for (const path of [".claude/CLAUDE.md", ".pi/agent/AGENTS.md"]) {
        expect(readlinkSync(join(setup.home, path))).toBe(join(source, "baseline.md"));
      }
      expect(readlinkSync(join(setup.home, ".local/bin/wt"))).toBe(join(source, "tools/worktree/target/release/wt"));
      expect(existsSync(join(setup.home, ".pi/agent/extensions/obsolete.ts"))).toBe(source === setup.source);
      expect(readlinkSync(independent)).toBe("/missing/personal-skill");
      expect(readFileSync(pi, "utf8")).toContain('"unknown":-0');
      expect(JSON.parse(readFileSync(pi, "utf8")).defaultModel).toBe("personal");
      expect(statSync(pi).mode & 0o777).toBe(0o640);
    }
    rmSync(setup.source, { recursive: true });
    const result = setup.runFrom(next);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(setup.home, ".pi/agent/extensions/obsolete.ts"))).toBe(false);
    expect(readlinkSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(join(next, "baseline.md"));
    for (const path of retained) expect(readFileSync(join(setup.home, path), "utf8")).toBe("personal state");
  } finally { setup.clean(); }
}, 40_000);
