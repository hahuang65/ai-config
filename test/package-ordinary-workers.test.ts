import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { CASE_GUARD_MS, MAKE_GUARD_MS, expectEveryFileOnce, workerFixture } from "./fixtures/bun-workers";

const first = ["test/package-claude-worktree.test.ts", "test/package-claude-discovery.test.ts",
  "test/package-pi-discovery.test.ts", "test/reviewer-runtime.test.ts", "test/package-pi-lsp-transport.test.ts"];
const remaining = ["test/package-new-scenario.test.ts", "test/guards.test.ts", "test/cli-links.test.ts", "test/resolve-conflicts.test.ts"];
const expected = [...first, ...remaining];
const excluded = ["test/package-install-unrelated.test.ts", "test/package-worktree.test.ts", "test/package-claude-worktree-runtime.test.ts"];
const fixture = () => workerFixture(resolve(import.meta.dir, "packages.mk"), [...expected, ...excluded], first[0]);

test("two ordinary package workers overlap and discover each eligible file once without installers or native groups", () => {
  const setup = fixture();
  try {
    const result = setup.run(2, "parallel");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expectEveryFileOnce(setup, expected);
    expect(result.stdout).toContain("[package 1] Fixture worker completed");
    expect(result.stdout).toContain("[package 2] Fixture worker completed");
  } finally { setup.clean(); }
}, CASE_GUARD_MS);

test("serial ordinary package workers finish in order and retain every eligible file", () => {
  const setup = fixture();
  try {
    const result = setup.run(1, "serial");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expectEveryFileOnce(setup, expected);
  } finally { setup.clean(); }
}, CASE_GUARD_MS);

test("both worker default checks ignore inherited serial package and installer overrides", () => {
  const result = spawnSync(process.execPath, ["test", resolve(import.meta.dir, "package-review-gate.test.ts"),
    "--test-name-pattern", "workers have a bounded default"], {
    cwd: resolve(import.meta.dir, ".."), encoding: "utf8", timeout: MAKE_GUARD_MS,
    env: { ...process.env, PACKAGE_TEST_JOBS: "1", INSTALL_TEST_JOBS: "1",
      MAKEFLAGS: " -- PACKAGE_TEST_JOBS=1 INSTALL_TEST_JOBS=1",
      MAKEOVERRIDES: "PACKAGE_TEST_JOBS=1 INSTALL_TEST_JOBS=1", MFLAGS: "", MAKELEVEL: "1" },
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, CASE_GUARD_MS);

for (const worker of ["1", "2"]) {
  test(`ordinary package worker ${worker} failure propagates through prefixed output`, () => {
    const setup = fixture();
    try {
      const result = setup.run(2, "parallel", worker);
      expect(result.status).not.toBe(0);
      expect(result.error).toBeUndefined();
      expect(result.stdout).toContain(`[package ${worker}] Fixture worker failed`);
      expectEveryFileOnce(setup, expected);
    } finally { setup.clean(); }
  }, CASE_GUARD_MS);
}

for (const empty of ["one", "two"]) {
  test(`an empty ordinary package worker ${empty} refuses an unfiltered Bun invocation`, () => {
    const setup = fixture();
    try {
      for (const path of empty === "one" ? first : remaining) rmSync(join(setup.temporary, path));
      const result = setup.run(2, "parallel");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Ordinary package worker ${empty} has no test files`);
      expect(setup.calls()).toEqual([]);
    } finally { setup.clean(); }
  }, CASE_GUARD_MS);
}
