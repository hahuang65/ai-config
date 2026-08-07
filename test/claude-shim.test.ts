import { test, expect } from "bun:test";
import { evaluateClaudePayload } from "../harnesses/claude/hooks/guard-verdict";

// Drive the Claude shim the way Claude Code would: pipe a PreToolUse payload
// on stdin and read the verdict JSON from stdout.
async function runShim(payload: object): Promise<string> {
  const proc = Bun.spawn(["bun", "harnesses/claude/hooks/guard.ts"], {
    stdin: Buffer.from(JSON.stringify(payload)),
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out;
}

test("Claude shim transports a credential denial over stdin and stdout", async () => {
  const out = await runShim({ tool_name: "Read", tool_input: { file_path: "/home/user/.aws/credentials" } });
  expect(out).toContain('"permissionDecision":"deny"');
});

test("Claude shim denies a bash credential read through the shared core", () => {
  const verdict = evaluateClaudePayload({ tool_name: "Bash", tool_input: { command: "cat ~/.aws/credentials" } });
  expect(verdict?.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("Claude shim denies an Edit whose new_string adds a hardcoded secret", () => {
  // Edit carries content in `new_string`, not `content` — the shim must forward it.
  // The key is concatenated so this test file is not itself a secret literal.
  const key = "AKIA" + "IOSFODNN7EXAMPLE";
  const verdict = evaluateClaudePayload({
    tool_name: "Edit",
    tool_input: { file_path: "config.ts", new_string: `const id = '${key}';` },
  });
  expect(verdict?.hookSpecificOutput.permissionDecision).toBe("deny");
});

test("Claude shim stays silent on an ordinary read", () => {
  const verdict = evaluateClaudePayload({ tool_name: "Read", tool_input: { file_path: "/home/user/README.md" } });
  expect(verdict).toBeNull();
});
