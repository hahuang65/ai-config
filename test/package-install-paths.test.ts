import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { installFixture } from "./fixtures/install-script";

test("shell bounds resource entry counts and refuses a 129-level resource tree", () => {
  const setup = installFixture();
  try {
    writeFileSync(join(setup.bin, "find"), '#!/bin/bash\nif [[ $1 == "$TREE_TARGET" ]]; then\n for ((i=0;i<100001;i++)); do printf "%s\\0" "$1"; done\nelse exec "$REAL_FIND" "$@"; fi\n', { mode: 0o755 });
    const count = setup.run([], { REAL_FIND: Bun.which("find")!, TREE_TARGET: join(setup.source, "baseline.md") });
    expect(count.status).toBe(1);
    expect(count.stderr).toContain("too large, or too deep");
    rmSync(join(setup.bin, "find"));
    mkdirSync(join(setup.source, "skills/commit", ...Array(129).fill("nested")), { recursive: true });
    const depth = setup.run();
    expect(depth.status).toBe(1);
    expect(depth.stderr).toContain("too large, or too deep");
    expect(existsSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(false);
    expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
  } finally { setup.clean(); }
}, 30_000);

test("shell refuses invalid or redirected homes and a source containing managed destinations", () => {
  const setup = installFixture();
  try {
    for (const HOME of [".", "/"]) {
      const result = setup.run([], { HOME, BUILD_STATUS: "97" });
      expect(result.status).toBe(1);
      expect(setup.calls()).toBe("");
    }
    const redirected = join(setup.temporary, "redirected-home");
    symlinkSync(setup.home, redirected);
    expect(setup.run([], { HOME: redirected }).status).toBe(1);
    expect(readdirSync(setup.home)).toEqual([]);
    const nestedSource = join(setup.home, ".pi/agent");
    cpSync(setup.source, nestedSource, { recursive: true });
    const original = readFileSync(join(nestedSource, "manifest.json"), "utf8");
    const result = setup.runFrom(nestedSource);
    expect(result.status, result.stderr).toBe(1);
    expect(result.stderr).toContain("Source contains an installation destination");
    expect(readFileSync(join(nestedSource, "manifest.json"), "utf8")).toBe(original);
    expect(existsSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(false);
    expect(existsSync(join(setup.home, ".local/state/ai-config/installation.json"))).toBe(false);
  } finally { setup.clean(); }
}, 20_000);

for (const relative of [".pi", ".pi/agent", ".local/state/ai-config",
  ".local/state/ai-config/installation.json", ".local/state/ai-config/install.lock.d"]) {
  test(`shell refuses redirected ${relative} without writing outside its home`, () => {
    const setup = installFixture();
    try {
      const outside = join(setup.temporary, "outside");
      mkdirSync(outside);
      writeFileSync(join(outside, "retained"), "personal");
      const link = join(setup.home, relative);
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(outside, link);
      const result = setup.run();
      expect(result.status, result.stderr).toBe(1);
      expect(readdirSync(outside)).toEqual(["retained"]);
      expect(readFileSync(join(outside, "retained"), "utf8")).toBe("personal");
      expect(readlinkSync(link)).toBe(outside);
      expect(existsSync(join(setup.home, ".claude/CLAUDE.md"))).toBe(false);
    } finally { setup.clean(); }
  }, 15_000);
}
