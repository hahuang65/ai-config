import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const plan = (target: string) => spawnSync("make", ["--no-print-directory", "-n", target], {
  cwd: root, encoding: "utf8", timeout: 15000,
});
const checks = (output: string) => output.split("\n").filter(line =>
  /bun test|cargo test|python -m unittest|python tools\/worktree\/tests\/rust_parity|node --test/.test(line));

test("prepared verification runs the complete test plan without rewriting generated source", () => {
  const normal = plan("test"), prepared = plan("test-prepared");
  expect(normal.status, normal.stderr).toBe(0);
  expect(prepared.status, prepared.stderr).toBe(0);
  expect(checks(prepared.stdout)).toEqual(checks(normal.stdout));
  expect(checks(prepared.stdout).length).toBeGreaterThan(8);
  expect(prepared.stdout).not.toMatch(/bun install|bun build|node tools\/build-|bun tools\/build-/);
  expect(normal.stdout).toContain("bun install --frozen-lockfile --ignore-scripts --omit peer");
});
