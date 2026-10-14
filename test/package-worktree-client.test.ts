import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worktrees } from "../harnesses/worktree-client";

test("native adapters report worktree removal separately from failed branch deletion", () => {
  const home = mkdtempSync(join(tmpdir(), "wt-partial-"));
  const executable = join(home, "wt");
  try {
    writeFileSync(executable, `#!/bin/sh\nprintf '%s\\n' '{"protocolVersion":1,"command":"clean","removed":true,"branchRemoved":false,"cleanupIncomplete":true,"worktree":{"task":"feature"},"branchReason":"branch changed"}'\nexit 1\n`);
    chmodSync(executable, 0o755);
    expect(() => new Worktrees(executable).run(home, ["clean", "feature", "--json"]))
      .toThrow("Worktree removed; local branch retained: branch changed");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
