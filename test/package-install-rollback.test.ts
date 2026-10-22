import { expect, test } from "bun:test";
import { chmodSync, cpSync, existsSync, readFileSync, readlinkSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installerScenarioGuard, installFixture } from "./fixtures/install-script";

for (const destination of [".pi/agent/AGENTS.md", ".pi/agent/settings.json", ".local/state/ai-config/installation.json",
  ".local/share/bash-completion/completions/wt", ".local/share/bash-completion/completions/worktree"]) {
  test(`shell rolls back a source switch when writing ${destination} fails`, () => {
    const setup = installFixture();
    try {
      const manifestFile = join(setup.source, "manifest.json");
      const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
      manifest.links.push({ destination: ".pi/agent/extensions/obsolete.ts", target: "harnesses/pi/obsolete.ts" });
      writeFileSync(join(setup.source, "harnesses/pi/obsolete.ts"), "// fixture\n");
      writeFileSync(manifestFile, JSON.stringify(manifest));
      expect(setup.run().status).toBe(0);
      const next = join(setup.temporary, "next source");
      cpSync(setup.source, next, { recursive: true });
      manifest.links = manifest.links.filter((link: { destination: string }) => !link.destination.endsWith("/obsolete.ts"));
      manifest.settings = manifest.settings.filter((claim: { destination: string }) => claim.destination !== ".pi/agent/settings.json");
      writeFileSync(join(next, "manifest.json"), JSON.stringify(manifest));
      const files = [".claude/settings.json", ".pi/agent/settings.json", ".local/state/ai-config/installation.json"];
      const originals = files.map(path => readFileSync(join(setup.home, path), "utf8"));
      chmodSync(join(setup.home, files[0]), 0o640);
      writeFileSync(join(setup.bin, "mv"), '#!/bin/bash\nif [[ $1 == --version ]]; then exec "$REAL_MV" "$@"; fi\nif [[ ${!#} == "$HOME/$FAIL_DESTINATION" ]]; then exit 23; fi\nexec "$REAL_MV" "$@"\n', { mode: 0o755 });
      const result = setup.runFrom(next, { REAL_MV: Bun.which("mv")!, FAIL_DESTINATION: destination });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("prior links and settings restored");
      expect(files.map(path => readFileSync(join(setup.home, path), "utf8"))).toEqual(originals);
      expect(statSync(join(setup.home, files[0])).mode & 0o777).toBe(0o640);
      for (const link of JSON.parse(originals[2]).links) {
        expect(readlinkSync(join(setup.home, link.destination))).toBe(join(setup.source, link.target));
      }
      expect(existsSync(join(setup.home, ".local/state/ai-config/install.lock.d"))).toBe(false);
    } finally { setup.clean(); }
  }, installerScenarioGuard(2));
}

test("shell preserves a native settings edit after preflight and restores completed link changes", () => {
  const setup = installFixture();
  try {
    expect(setup.run().status).toBe(0);
    const record = join(setup.home, ".local/state/ai-config/installation.json");
    const before = readFileSync(record, "utf8");
    const claude = readFileSync(join(setup.home, ".claude/settings.json"), "utf8");
    const next = join(setup.temporary, "next source");
    cpSync(setup.source, next, { recursive: true });
    const manifest = JSON.parse(readFileSync(join(next, "manifest.json"), "utf8"));
    manifest.settings = manifest.settings.filter((claim: { destination: string }) => claim.destination !== ".pi/agent/settings.json");
    writeFileSync(join(next, "manifest.json"), JSON.stringify(manifest));
    const concurrent = '{"theme":"catppuccin-mocha","defaultModel":"private-native-choice"}';
    writeFileSync(join(setup.bin, "mv"), '#!/bin/bash\nif [[ $1 == --version ]]; then exec "$REAL_MV" "$@"; fi\nif [[ ${!#} == "$HOME/.claude/CLAUDE.md" ]]; then printf "%s" "$CONCURRENT" > "$HOME/.pi/agent/settings.json"; fi\nexec "$REAL_MV" "$@"\n', { mode: 0o755 });
    const result = setup.runFrom(next, { REAL_MV: Bun.which("mv")!, CONCURRENT: concurrent });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("prior links and settings restored");
    expect(result.stderr).not.toContain("private-native-choice");
    expect(readFileSync(record, "utf8")).toBe(before);
    expect(readFileSync(join(setup.home, ".claude/settings.json"), "utf8")).toBe(claude);
    expect(readFileSync(join(setup.home, ".pi/agent/settings.json"), "utf8")).toBe(concurrent);
    for (const link of JSON.parse(before).links) {
      expect(readlinkSync(join(setup.home, link.destination))).toBe(join(setup.source, link.target));
    }
  } finally { setup.clean(); }
}, installerScenarioGuard(2));

test("a failed first installation removes its newly created settings and links", () => {
  const setup = installFixture();
  try {
    writeFileSync(join(setup.bin, "mv"), '#!/bin/bash\nif [[ $1 == --version ]]; then exec "$REAL_MV" "$@"; fi\nif [[ ${!#} == "$HOME/.local/state/ai-config/installation.json" ]]; then exit 23; fi\nexec "$REAL_MV" "$@"\n', { mode: 0o755 });
    const result = setup.run([], { REAL_MV: Bun.which("mv")! });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("prior links and settings restored");
    for (const path of [".claude/settings.json", ".pi/agent/settings.json", ".claude/CLAUDE.md", ".pi/agent/AGENTS.md",
      ".local/state/ai-config/installation.json", ".local/state/ai-config/install.lock.d"]) {
      expect(existsSync(join(setup.home, path))).toBe(false);
    }
  } finally { setup.clean(); }
}, installerScenarioGuard(1));
