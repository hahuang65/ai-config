import { expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installerScenarioGuard, installFixture } from "./fixtures/install-script";

test("install.sh owns installation without a Rust installer and preserves personal settings", () => {
  const setup = installFixture();
  try {
    mkdirSync(join(setup.home, ".pi/agent"), { recursive: true });
    const settings = join(setup.home, ".pi/agent/settings.json");
    writeFileSync(settings, '{"defaultModel":"personal","unknown":-0}\n');
    const result = setup.run();
    expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
    expect(setup.calls()).toBe(`${setup.source}\nbuild\n`);
    expect(readlinkSync(join(setup.home, ".pi/agent/AGENTS.md"))).toBe(join(setup.source, "baseline.md"));
    expect(readlinkSync(join(setup.home, ".local/bin/review-change")))
      .toBe(join(setup.source, "tools/evaluation/target/release/review-change"));
    for (const helper of ["consult", "review-artifact", "artifact-review", "evaluation", "ai-config"]) {
      expect(existsSync(join(setup.home, ".local/bin", helper))).toBe(false);
    }
    expect(readFileSync(settings, "utf8")).toContain('"unknown":-0');
    expect(JSON.parse(readFileSync(settings, "utf8"))).toMatchObject({ defaultModel: "personal", theme: "catppuccin-mocha" });
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const before = readFileSync(record, "utf8");
    expect(setup.run().status).toBe(0);
    expect(readFileSync(record, "utf8")).toBe(before);
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("repeat installation keeps the ownership record private without changing its bytes", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const original = readFileSync(record, "utf8");
    chmodSync(record, 0o644);
    expect(setup.run().status).toBe(0);
    expect(readFileSync(record, "utf8")).toBe(original);
    expect(statSync(record).mode & 0o777).toBe(0o600);
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("rollback refuses concurrent edits and retains a private workspace and blocking lock", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const settings = join(setup.home, ".claude/settings.json");
    const originalRecord = readFileSync(record, "utf8");
    const manifestPath = join(setup.source, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.settings.push({ destination: ".claude/settings.json", path: ["permissions", "allow"],
      mode: "array_entry", value: "Read(fixture/**)" });
    writeFileSync(manifestPath, JSON.stringify(manifest));
    writeFileSync(join(setup.bin, "mv"), '#!/bin/bash\nif [[ $1 == --version ]]; then exec "$REAL_MV" "$@"; fi\nif [[ ${!#} == "$HOME/.local/state/ai-config/installation.json" ]]; then printf "%s" "$FOREIGN_SETTINGS" > "$HOME/.claude/settings.json"; exit 23; fi\nexec "$REAL_MV" "$@"\n', { mode: 0o755 });
    const foreign = '{"personal":"concurrent edit"}\n';
    const result = setup.run([], { REAL_MV: Bun.which("mv")!, FOREIGN_SETTINGS: foreign });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Rollback incomplete");
    expect(readFileSync(settings, "utf8")).toBe(foreign);
    expect(readFileSync(record, "utf8")).toBe(originalRecord);
    const lock = join(setup.home, ".local/state/ai-config/install.lock.d");
    const workspace = readFileSync(join(lock, "workspace"), "utf8").trim();
    expect(workspace.startsWith(setup.temporary + "/")).toBe(true);
    expect(statSync(workspace).mode & 0o777).toBe(0o700);
    expect(existsSync(join(workspace, "journal"))).toBe(true);
    unlinkSync(join(setup.bin, "mv"));
    const retry = setup.run();
    expect(retry.status).toBe(1);
    expect(retry.stderr).toContain("interrupted work needs inspection");
    expect(readFileSync(settings, "utf8")).toBe(foreign);
  } finally { setup.clean(); }
}, installerScenarioGuard(3));

test("a failed ownership-record write restores prior links, settings bytes, and permissions", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const settings = join(setup.home, ".claude/settings.json");
    chmodSync(settings, 0o640);
    const originalRecord = readFileSync(record, "utf8");
    const originalSettings = readFileSync(settings, "utf8");
    const manifestPath = join(setup.source, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.links.push({ destination: ".pi/agent/extensions/fixture.ts", target: "harnesses/pi/fixture.ts" });
    manifest.settings.push({ destination: ".claude/settings.json", path: ["permissions", "allow"],
      mode: "array_entry", value: "Read(fixture/**)" });
    writeFileSync(join(setup.source, "harnesses/pi/fixture.ts"), "// never executed\n");
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const moves = join(setup.temporary, "moves");
    writeFileSync(join(setup.bin, "mv"), '#!/bin/bash\nif [[ $1 == --version ]]; then exec "$REAL_MV" "$@"; fi\nprintf "%s\\n" "${!#}" >> "$MOVE_LOG"\nif [[ ${!#} == "$HOME/.local/state/ai-config/installation.json" ]]; then exit 23; fi\nexec "$REAL_MV" "$@"\n', { mode: 0o755 });
    const result = setup.run([], { REAL_MV: Bun.which("mv")!, MOVE_LOG: moves });
    expect(result.status).not.toBe(0);
    expect(readFileSync(moves, "utf8")).toContain(".claude/settings.json");
    expect(readFileSync(record, "utf8")).toBe(originalRecord);
    expect(readFileSync(settings, "utf8")).toBe(originalSettings);
    expect(statSync(settings).mode & 0o777).toBe(0o640);
    expect(existsSync(join(setup.home, ".pi/agent/extensions/fixture.ts"))).toBe(false);
    expect(result.stderr).toContain("prior links and settings restored");
    expect(readdirSync(join(setup.home, ".local/state/ai-config")).filter(name => name.startsWith(".ai-config-"))).toEqual([]);
    expect(existsSync(join(setup.home, ".local/state/ai-config/install.lock.d"))).toBe(false);
    unlinkSync(join(setup.bin, "mv"));
    expect(setup.run().status).toBe(0);
  } finally { setup.clean(); }
}, installerScenarioGuard(3));
