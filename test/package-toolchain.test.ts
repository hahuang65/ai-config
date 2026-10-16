import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("mise declares the build runtimes and a rolling project Pi without changing language servers", () => {
  const config = Bun.TOML.parse(readFileSync(new URL("../mise.toml", import.meta.url), "utf8")) as any;
  expect(config.tools.bun).toBe("1.3.14");
  expect(config.tools.node).toBe("25.8.0");
  expect(config.tools.python).toBe("3.11.4");
  expect(config.tools["npm:@earendil-works/pi-coding-agent"]).toBe("latest");
  expect(config.settings.python.compile).toBe(true);
  expect(config.settings.npm.package_manager).toBe("npm");
  expect(config.tools.rust).toBe("1.99.0");
  expect(config.tools.shellcheck).toBe("0.11.0");
});

test("missing or malformed project Pi selection never falls back to a global client or leaks mise diagnostics", () => {
  const root = mkdtempSync(join(tmpdir(), "project-pi-missing-"));
  try {
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "mise"), '#!/bin/sh\nprintf "%s" "$TEST_MISE_OUTPUT"\nprintf "fixture-private-diagnostic" >&2\nexit "$TEST_MISE_STATUS"\n', { mode: 0o755 });
    const module = new URL("../tools/project-pi.mjs", import.meta.url).href;
    for (const [output, status] of [["/ignored", "1"], ["relative/pi", "0"], ["/first\n/second", "0"]]) {
      const run = Bun.spawnSync([process.execPath, "-e",
        `import { projectPiExecutable } from ${JSON.stringify(module)}; projectPiExecutable();`], {
        env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TEST_MISE_OUTPUT: output, TEST_MISE_STATUS: status },
      });
      expect(run.exitCode).not.toBe(0);
      expect(run.stderr.toString()).toContain("explicitly run mise install npm:@earendil-works/pi-coding-agent");
      expect(run.stderr.toString()).not.toContain("fixture-private-diagnostic");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
