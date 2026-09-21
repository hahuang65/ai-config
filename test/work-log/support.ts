import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const CLI = new URL("../../skills/record-work/bin/work-log.mjs", import.meta.url).pathname;
const temporaryDirectories: string[] = [];

export function cleanupTemporaryDirectories(): void {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
}

export function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

export function git(cwd: string, ...args: string[]): void {
  const invocation = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (invocation.status !== 0) throw new Error(invocation.stderr);
}

export function repository(): string {
  const directory = temporaryDirectory("work-log-repository-");
  git(directory, "init", "--initial-branch=main");
  git(directory, "remote", "add", "origin", "git@github.com:Example/Project.git");
  return directory;
}

export function runWorkLog(
  cwd: string,
  store: string,
  input: Record<string, unknown>,
  now = "2026-09-18T10:30:00.000Z",
) {
  return spawnSync("node", [CLI, "record"], {
    cwd,
    encoding: "utf8",
    input: JSON.stringify(input),
    env: {
      ...process.env,
      WORK_LOG_DIR: store,
      WORK_LOG_NOW: now,
      PI_SESSION_ID: "pi-session-1",
    },
  });
}
