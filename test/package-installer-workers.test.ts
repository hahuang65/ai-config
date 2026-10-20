import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { CASE_GUARD_MS, MAKE_GUARD_MS, expectEveryFileOnce, workerFixture } from "./fixtures/bun-workers";
const names = ["rollback", "records", "paths", "performance", "safety", "new-scenario"];
function fixture() {
  const files = names.map(name => `test/package-install-${name}.test.ts`);
  return workerFixture(resolve(import.meta.dir, "installers.mk"), files, files[0]);
}

test("two installer processes overlap at a barrier and include newly discovered files exactly once", () => {
  const setup = fixture();
  try {
    const result = setup.run(2, "parallel");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expectEveryFileOnce(setup);
    expect(result.stdout).toContain("[installer 1] Fixture worker completed");
    expect(result.stdout).toContain("[installer 2] Fixture worker completed");
  } finally { setup.clean(); }
}, CASE_GUARD_MS);

test("one installer worker finishes before the next worker starts", () => {
  const setup = fixture();
  try {
    const result = setup.run(1, "serial");
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expectEveryFileOnce(setup);
  } finally { setup.clean(); }
}, CASE_GUARD_MS);

test("gate default checks ignore an enclosing serial Make override", () => {
  const result = spawnSync(process.execPath, ["test", resolve(import.meta.dir, "package-review-gate.test.ts"),
    "--test-name-pattern", "installer workers have a bounded default"], {
    cwd: resolve(import.meta.dir, ".."), encoding: "utf8", timeout: MAKE_GUARD_MS,
    env: { ...process.env, INSTALL_TEST_JOBS: "1", MAKEFLAGS: " -- INSTALL_TEST_JOBS=1",
      MAKEOVERRIDES: "INSTALL_TEST_JOBS=1", MFLAGS: "", MAKELEVEL: "1" },
  });
  expect(result.status, result.stdout + result.stderr).toBe(0);
}, CASE_GUARD_MS);

for (const worker of ["1", "2"]) {
  test(`installer worker ${worker} failure is not hidden by output prefixing`, () => {
    const setup = fixture();
    try {
      const result = setup.run(2, "parallel", worker);
      expect(result.status).not.toBe(0);
      expect(result.error).toBeUndefined();
      expect(result.stdout).toContain(`[installer ${worker}] Fixture worker failed`);
      expectEveryFileOnce(setup);
    } finally { setup.clean(); }
  }, CASE_GUARD_MS);
}

for (const empty of ["one", "two"]) {
  test(`an empty installer worker ${empty} refuses to run an unfiltered Bun suite`, () => {
    const setup = fixture();
    try {
      for (const path of setup.files) {
        const heavy = names.slice(0, 4).some(name => path.endsWith(`-${name}.test.ts`));
        if (heavy === (empty === "one")) rmSync(join(setup.temporary, path));
      }
      const result = setup.run(2, "parallel");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`Installer worker ${empty} has no test files`);
      expect(setup.calls()).toEqual([]);
    } finally { setup.clean(); }
  }, CASE_GUARD_MS);
}
