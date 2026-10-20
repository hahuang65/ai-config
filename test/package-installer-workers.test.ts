import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const WORKER_BARRIER_SECONDS = 3;
const MAKE_GUARD_MS = 10_000;
const CASE_GUARD_MS = 15_000;
const names = ["rollback", "records", "paths", "performance", "safety", "new-scenario"];
const fakeBun = String.raw`#!/bin/bash
set -eu
case "$*" in *package-install-rollback.test.ts*) id=1 ;; *) id=2 ;; esac
other=$((3 - id))
printf '%s\n' "$@" > "$STATE/args-$$"
printf ready > "$STATE/$id.started"
if [[ $FAKE_MODE == parallel ]]; then
  deadline=$((SECONDS + ${WORKER_BARRIER_SECONDS}))
  until [[ -e "$STATE/$other.started" ]]; do
    if (( SECONDS >= deadline )); then printf 'Worker barrier timed out\n' >&2; exit 71; fi
    sleep 0.01
  done
elif [[ $id == 2 && ! -e "$STATE/1.finished" ]]; then
  printf 'Serial workers overlapped\n' >&2; exit 72
fi
if [[ $FAIL_WORKER == "$id" ]]; then printf 'Fixture worker failed\n' >&2; exit 7; fi
printf done > "$STATE/$id.finished"
printf 'Fixture worker completed\n'
`;

function fixture() {
  const temporary = mkdtempSync(join(tmpdir(), "installer-workers-"));
  const bin = join(temporary, "bin"), state = join(temporary, "state");
  for (const directory of [bin, state, join(temporary, "test"), join(temporary, "home")]) mkdirSync(directory);
  const makefile = join(temporary, "installers.mk");
  copyFileSync(resolve(import.meta.dir, "installers.mk"), makefile);
  writeFileSync(join(bin, "bun"), fakeBun, { mode: 0o755 });
  const files = names.map(name => `test/package-install-${name}.test.ts`);
  for (const path of files) writeFileSync(join(temporary, path), "");
  return {
    temporary, state, files, makefile,
    run: (jobs: number, mode: string, failure = "") => spawnSync("make", ["--no-print-directory", "-f", makefile, `-j${jobs}`], {
      cwd: temporary, encoding: "utf8", timeout: MAKE_GUARD_MS,
      env: { ...process.env, HOME: join(temporary, "home"), PATH: `${bin}:${process.env.PATH}`,
        STATE: state, FAKE_MODE: mode, FAIL_WORKER: failure, MAKEFLAGS: "", MFLAGS: "", BASH_ENV: "", ENV: "" },
    }),
    calls: () => readdirSync(state).filter(name => name.startsWith("args-")).map(name => readFileSync(join(state, name), "utf8").trim().split("\n")),
    clean: () => rmSync(temporary, { recursive: true, force: true }),
  };
}

function expectEveryFileOnce(setup: ReturnType<typeof fixture>) {
  const calls = setup.calls();
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(call[0]).toBe("test");
  expect(calls.flatMap(call => call.slice(1)).sort()).toEqual(setup.files.toSorted());
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
