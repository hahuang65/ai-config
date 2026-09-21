import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("Work log installation", () => {
  test("installs the agent-facing CLI independently of either harness", () => {
    const installer = readFileSync(new URL("../../install.sh", import.meta.url), "utf8");

    expect(installer).toContain("skills/record-work/bin/work-log.mjs");
    expect(installer).toContain('WORK_LOG_CLI_TARGET="$CLI_BIN_DIR/work-log"');
  });
});
