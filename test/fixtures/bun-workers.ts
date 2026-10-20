import { expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const WORKER_BARRIER_SECONDS = 3;
export const MAKE_GUARD_MS = 10_000;
export const CASE_GUARD_MS = 15_000;
const fakeBun = String.raw`#!/bin/bash
set -eu
case " $* " in *" $WORKER_FIRST_FILE "*) id=1 ;; *) id=2 ;; esac
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

export function workerFixture(source: string, files: readonly string[], firstFile: string) {
  const temporary = mkdtempSync(join(tmpdir(), "bun-workers-"));
  const bin = join(temporary, "bin"), state = join(temporary, "state");
  for (const directory of [bin, state, join(temporary, "test"), join(temporary, "home")]) mkdirSync(directory);
  const makefile = join(temporary, "workers.mk");
  copyFileSync(source, makefile);
  writeFileSync(join(bin, "bun"), fakeBun, { mode: 0o755 });
  for (const path of files) writeFileSync(join(temporary, path), "");
  return {
    temporary, state, files, makefile,
    run: (jobs: number, mode: string, failure = "") => spawnSync("make", ["--no-print-directory", "-f", makefile, `-j${jobs}`], {
      cwd: temporary, encoding: "utf8", timeout: MAKE_GUARD_MS,
      env: { ...process.env, HOME: join(temporary, "home"), PATH: `${bin}:${process.env.PATH}`,
        STATE: state, FAKE_MODE: mode, FAIL_WORKER: failure, WORKER_FIRST_FILE: firstFile,
        MAKEFLAGS: "", MFLAGS: "", MAKEOVERRIDES: "", MAKELEVEL: "0", BASH_ENV: "", ENV: "" },
    }),
    calls: () => readdirSync(state).filter(name => name.startsWith("args-")).map(name => readFileSync(join(state, name), "utf8").trim().split("\n")),
    clean: () => rmSync(temporary, { recursive: true, force: true }),
  };
}

export function expectEveryFileOnce(setup: ReturnType<typeof workerFixture>, expected = setup.files) {
  const calls = setup.calls();
  expect(calls).toHaveLength(2);
  for (const call of calls) expect(call[0]).toBe("test");
  expect(calls.flatMap(call => call.slice(1)).sort()).toEqual(expected.toSorted());
}
