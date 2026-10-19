import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("mise declares build runtimes without installing or shadowing the user's Pi", () => {
  const config = Bun.TOML.parse(readFileSync(new URL("../mise.toml", import.meta.url), "utf8")) as any;
  expect(config.tools.bun).toBe("1.3.14");
  expect(config.tools.node).toBe("25.8.0");
  expect(config.tools.python).toBe("3.11.4");
  expect(config.tools["npm:@earendil-works/pi-coding-agent"]).toBeUndefined();
  expect(config.settings.python.compile).toBe(true);
  expect(config.settings.npm.package_manager).toBe("npm");
  expect(config.tools.rust).toBe("1.99.0");
  expect(config.tools.shellcheck).toBe("0.11.0");
});

test("missing or unusable Pi gives installation guidance without running mise or candidate programs", () => {
  const root = mkdtempSync(join(tmpdir(), "project-pi-missing-"));
  try {
    const marker = join(root, "invoked");
    const script = `#!/bin/sh\nprintf "fixture-private-diagnostic" >&2\nprintf invoked > "${marker}"\n`;
    for (const name of ["shim", "nonexec", "directory", "dangling", "relative", "bad\npath"]) {
      mkdirSync(join(root, name));
    }
    writeFileSync(join(root, "mise"), script, { mode: 0o755 });
    symlinkSync(join(root, "mise"), join(root, "shim/pi"));
    writeFileSync(join(root, "nonexec/pi"), script, { mode: 0o644 });
    mkdirSync(join(root, "directory/pi"));
    symlinkSync(join(root, "missing"), join(root, "dangling/pi"));
    writeFileSync(join(root, "relative/pi"), script, { mode: 0o755 });
    writeFileSync(join(root, "bad\npath/pi"), script, { mode: 0o755 });
    const module = new URL("../tools/project-pi.mjs", import.meta.url).href;
    for (const path of ["", "relative", ...["shim", "nonexec", "directory", "dangling", "bad\npath"].map(name => join(root, name))]) {
      const run = Bun.spawnSync([process.execPath, "-e",
        `import { projectPiExecutable } from ${JSON.stringify(module)}; projectPiExecutable();`], {
        cwd: root, env: { ...process.env, PATH: path },
      });
      expect(run.exitCode).not.toBe(0);
      expect(run.stderr.toString()).toContain("install Pi separately and add it to PATH");
      expect(run.stderr.toString()).not.toContain("fixture-private-diagnostic");
      expect(existsSync(marker)).toBe(false);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
