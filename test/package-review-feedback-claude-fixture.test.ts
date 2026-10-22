import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { adapterScenario } from "./fixtures/review-feedback-claude";

test("Claude adapter fixtures copy a complete runtime without linking or modifying source", () => {
  const scenario = adapterScenario();
  const source = resolve(import.meta.dir, "..");
  try {
    for (const relative of ["manifest.json", "harnesses/claude/review-feedback.ts", "harnesses/review-feedback-client.ts",
      "tools/artifact-review/target/release/review-artifact"]) {
      const copied = join(scenario.runtime, relative);
      expect(lstatSync(copied).isSymbolicLink()).toBe(false);
      expect(statSync(copied).nlink).toBe(1);
      expect(realpathSync(copied).startsWith(`${scenario.runtime}/`)).toBe(true);
      expect(readFileSync(copied)).toEqual(readFileSync(join(source, relative)));
    }
    expect(statSync(scenario.cli).mode & 0o111).not.toBe(0);
    const result = spawnSync(process.execPath, [join(scenario.runtime, "harnesses/claude/review-feedback.ts"), "--focus"], {
      input: JSON.stringify({ hook_event_name: "SessionStart", session_id: "fixture-probe", cwd: scenario.root }),
      env: { HOME: scenario.home, AR_ROOT: join(scenario.home, "reviews"), PATH: process.env.PATH },
      cwd: scenario.root, encoding: "utf8", timeout: 10_000,
    });
    expect({ status: result.status, stdout: result.stdout, stderr: result.stderr }).toEqual({
      status: 0, stdout: "", stderr: "",
    });
    const relative = "harnesses/review-feedback-client.ts";
    const before = readFileSync(join(source, relative), "utf8");
    writeFileSync(join(scenario.runtime, relative), `${before}\n// Fixture-only change.\n`);
    expect(readFileSync(join(source, relative), "utf8")).toBe(before);
  } finally { rmSync(scenario.home, { recursive: true, force: true }); }
});
