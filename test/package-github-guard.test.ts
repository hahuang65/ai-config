import { beforeAll, expect, test } from "bun:test";
import { initializeShellParser } from "../guard/shell-parser";
import { evaluateClaudePayload } from "../harnesses/claude/guard-verdict";

beforeAll(async () => { expect(await initializeShellParser()).toBe(true); });
const decision = (command: string) => evaluateClaudePayload({ tool_name: "Bash", tool_input: { command }, cwd: "/tmp/project" },
  { environmentHome: "/home/disposable-user", platformHome: "/home/disposable-user" })?.hookSpecificOutput.permissionDecision;

test("Claude grants read-only GitHub permission from syntax, not punctuation in comments or quoted words", () => {
  for (const command of ["gh pr view # a comment; not another command", "gh api repos/owner/repo", "gh api -X GET repos/owner/repo", "gh pr view --jq '.title + \";\"'"]) {
    expect(decision(command), command).toBe("allow");
  }
  for (const command of ["gh pr view; printf ready", "gh pr view >/tmp/report", "gh pr view $(printf 1)",
    "gh api -X POST repos/owner/repo", "gh api -F data=@local.json repos/owner/repo", "env gh pr view"]) {
    expect(decision(command), command).not.toBe("allow");
  }
});
