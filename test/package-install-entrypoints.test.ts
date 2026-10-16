import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installFixture } from "./fixtures/install-script";

test("component installation guidance routes to the sole package shell entry point", () => {
  for (const path of ["tools/worktree/README.md", "tools/worklog/README.md", "tools/worklog/docs/cli.md"]) {
    const text = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
    expect(text, path).toContain("./install.sh");
    expect(text, path).not.toContain("target/release/ai-config");
    expect(text, path).not.toContain("tools/worktree/install.py");
  }
});

test("only the package installer owns WT links and refuses foreign files or dangling links", () => {
  expect(existsSync(new URL("../tools/worktree/install.py", import.meta.url))).toBe(false);
  const setup = installFixture();
  try {
    const target = join(setup.home, ".local/bin/wt");
    const missing = join(setup.temporary, "missing foreign tool");
    mkdirSync(dirname(target), { recursive: true });
    for (const kind of ["regular", "dangling"]) {
      if (kind === "regular") writeFileSync(target, "another tool");
      else symlinkSync(missing, target);
      for (const args of [[], ["--uninstall"]]) {
        const result = setup.run(args);
        expect(result.status, result.stderr).toBe(args.length ? 2 : 1);
        if (kind === "regular") expect(readFileSync(target, "utf8")).toBe("another tool");
        else expect(readlinkSync(target)).toBe(missing);
        expect(existsSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(false);
        expect(existsSync(join(setup.home, ".pi/agent/AGENTS.md"))).toBe(false);
        expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
      }
      rmSync(target);
    }
  } finally { setup.clean(); }
}, 20_000);
