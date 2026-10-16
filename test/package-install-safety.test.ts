import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, linkSync, lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { installFixture } from "./fixtures/install-script";

for (const kind of ["symlink", "hard link", "directory", "FIFO", "duplicate keys", "invalid UTF-8",
  "malformed JSON", "non-object JSON", "overdeep JSON", "oversized JSON", "unowned matching value"]) {
  test(`shell installer refuses ${kind} settings before changing managed resources`, () => {
    const setup = installFixture();
    try {
      mkdirSync(join(setup.home, ".pi/agent"), { recursive: true });
      const settings = join(setup.home, ".pi/agent/settings.json");
      const outside = join(setup.temporary, "outside.json");
      const original = '{"personal":"do-not-log-this-fixture"}\n';
      writeFileSync(outside, original);
      if (kind === "symlink") symlinkSync(outside, settings);
      else if (kind === "hard link") linkSync(outside, settings);
      else if (kind === "directory") mkdirSync(settings);
      else if (kind === "FIFO") expect(spawnSync("mkfifo", [settings]).status).toBe(0);
      else if (kind === "duplicate keys") writeFileSync(settings, '{"personal":"do-not-log-this-fixture","personal":2}');
      else if (kind === "malformed JSON") writeFileSync(settings, '{"personal":"do-not-log-this-fixture", broken}');
      else if (kind === "non-object JSON") writeFileSync(settings, '["do-not-log-this-fixture"]');
      else if (kind === "overdeep JSON") writeFileSync(settings, '{"personal":"do-not-log-this-fixture","nested":' + '['.repeat(129) + '0' + ']'.repeat(129) + '}');
      else if (kind === "oversized JSON") writeFileSync(settings, '{"personal":"do-not-log-this-fixture","padding":"' + 'x'.repeat(16 * 1024 * 1024) + '"}');
      else if (kind === "unowned matching value") writeFileSync(settings, '{"personal":"do-not-log-this-fixture","theme":"catppuccin-mocha"}');
      else writeFileSync(settings, Buffer.concat([Buffer.from('{"personal":"'), Buffer.from([0xff]), Buffer.from('"}') ]));
      const before = lstatSync(settings).isFile() ? readFileSync(settings) : undefined;
      const result = setup.run();
      expect(result.status).not.toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).not.toContain("do-not-log-this-fixture");
      expect(readFileSync(outside, "utf8")).toBe(original);
      if (before) expect(readFileSync(settings)).toEqual(before);
      expect(existsSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(false);
      expect(existsSync(join(setup.home, ".local/bin/wt"))).toBe(false);
      expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
      expect(existsSync(join(setup.home, ".local/state/ai-config/install.lock.d"))).toBe(false);
    } finally { setup.clean(); }
  }, 30_000);
}
