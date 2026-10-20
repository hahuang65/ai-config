import { expect, test } from "bun:test";
import { existsSync, lstatSync, linkSync, mkdirSync, readFileSync, readlinkSync, symlinkSync, truncateSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { installFixture, installerScenarioGuard } from "./fixtures/install-script";

function trace(setup: ReturnType<typeof installFixture>, tool: "mkdir" | "stat" | "find") {
  const key = tool.toUpperCase();
  const calls = join(setup.temporary, `${tool}-calls`);
  writeFileSync(calls, "");
  writeFileSync(join(setup.bin, tool), `#!/bin/bash\nprintf "%s\\0" "$@" >> "$${key}_CALLS"\nprintf "\\n" >> "$${key}_CALLS"\nexec "$REAL_${key}" "$@"\n`, { mode: 0o755 });
  return {
    environment: { [`REAL_${key}`]: Bun.which(tool)!, [`${key}_CALLS`]: calls },
    invocations: () => readFileSync(calls, "utf8").split("\n").map(line => line.split("\0")),
  };
}

test("one installation reuses parents, batches support metadata, and traverses only resource directories", () => {
  const setup = installFixture();
  try {
    const manifest = JSON.parse(readFileSync(join(setup.source, "manifest.json"), "utf8"));
    const parents = new Set<string>(manifest.links.map((link: { destination: string }) => dirname(join(setup.home, link.destination))));
    for (const parent of parents) mkdirSync(parent, { recursive: true });
    const targets = [...new Set<string>(manifest.links.map((link: { target: string }) => join(setup.source, link.target)))];
    const files = targets.filter(path => lstatSync(path).isFile());
    const directories = targets.filter(path => lstatSync(path).isDirectory());
    expect(files.length).toBeGreaterThan(0);
    expect(directories.length).toBeGreaterThan(0);
    const catalogue = spawnSync("jq", ["-L", join(setup.source, "tools/install"), "-nc",
      'include "manifest"; support_files - ([public_tools[]] + private_tools) | unique'], { encoding: "utf8", timeout: 10_000 });
    expect(catalogue.status).toBe(0);
    const support = JSON.parse(catalogue.stdout).map((path: string) => join(setup.source, path));
    expect(support.length).toBeGreaterThan(1);
    const mkdir = trace(setup, "mkdir"), stat = trace(setup, "stat"), find = trace(setup, "find");
    const result = setup.run([], { ...mkdir.environment, ...stat.environment, ...find.environment });
    expect(result.status, result.stderr).toBe(0);
    const mkdirArguments = mkdir.invocations().flat();
    for (const parent of parents) expect(mkdirArguments.filter(argument => argument === parent), parent).toHaveLength(0);
    const invocations = stat.invocations();
    expect(invocations.filter(arguments_ => support.every((path: string) => arguments_.includes(path)))).toHaveLength(1);
    for (const path of support) expect(invocations.some(arguments_ => arguments_.includes(path)), path).toBe(true);
    const findArguments = find.invocations().flat();
    for (const path of files) expect(findArguments, path).not.toContain(path);
    for (const path of directories) expect(findArguments, path).toContain(path);
    for (const link of manifest.links) {
      expect(readlinkSync(join(setup.home, link.destination))).toBe(join(setup.source, link.target));
    }
    const owned = JSON.parse(readFileSync(join(setup.home, ".local/state/ai-config/installation.json"), "utf8"));
    expect(owned.source).toBe(setup.source);
    expect(owned.links).toEqual(manifest.links);
    expect(JSON.parse(readFileSync(join(setup.home, ".pi/agent/settings.json"), "utf8")).theme).toBe("catppuccin-mocha");
  } finally { setup.clean(); }
}, installerScenarioGuard(1));

for (const fault of ["failed", "truncated", "hard-linked", "oversized", "symlink", "swapped"]) {
  test(`support metadata rejects ${fault} evidence before changing the home`, () => {
    const setup = installFixture();
    try {
      const path = join(setup.source, "guard/bash-command.ts");
      if (fault === "hard-linked") linkSync(path, join(setup.temporary, "alias.ts"));
      else if (fault === "oversized") truncateSync(path, 16 * 1024 * 1024 + 1);
      else if (fault === "symlink") {
        const outside = join(setup.temporary, "foreign.ts");
        writeFileSync(outside, "unowned source\n");
        unlinkSync(path); symlinkSync(outside, path);
      } else if (fault === "swapped") {
        writeFileSync(join(setup.temporary, "foreign.ts"), "unowned source\n");
        writeFileSync(join(setup.bin, "stat"), '#!/bin/bash\nif [[ $1 == --printf ]]; then rm -- "$SUPPORT_FILE"; ln -s -- "$SWAP_TARGET" "$SUPPORT_FILE"; fi\nexec "$REAL_STAT" "$@"\n', { mode: 0o755 });
      } else {
        writeFileSync(join(setup.bin, "stat"), '#!/bin/bash\nif [[ $1 == --printf ]]; then printf "81a4 1 0\\0"; exit "$METADATA_EXIT"; fi\nexec "$REAL_STAT" "$@"\n', { mode: 0o755 });
      }
      const result = setup.run([], { REAL_STAT: Bun.which("stat")!, METADATA_EXIT: fault === "failed" ? "7" : "0", SUPPORT_FILE: path, SWAP_TARGET: join(setup.temporary, "foreign.ts") });
      expect(result.status).not.toBe(0);
      for (const relative of [".claude/CLAUDE.md", ".pi/agent/AGENTS.md", ".local/state/ai-config/installation.json", ".local/state/ai-config/install.lock.d"]) {
        expect(existsSync(join(setup.home, relative)), relative).toBe(false);
      }
    } finally { setup.clean(); }
  }, installerScenarioGuard(1));
}
