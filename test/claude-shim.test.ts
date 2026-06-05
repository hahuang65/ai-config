import { test, expect } from "bun:test";

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

test("Claude shim denies a credential read through the shared core", async () => {
  const out = await runShim({ tool_name: "Read", tool_input: { file_path: "/home/user/.aws/credentials" } });
  expect(out).toContain('"permissionDecision":"deny"');
});

test("Claude shim denies a bash credential read through the shared core", async () => {
  const out = await runShim({ tool_name: "Bash", tool_input: { command: "cat ~/.aws/credentials" } });
  expect(out).toContain('"permissionDecision":"deny"');
});

test("Claude shim stays silent on an ordinary read", async () => {
  const out = await runShim({ tool_name: "Read", tool_input: { file_path: "/home/user/README.md" } });
  expect(out.trim()).toBe("");
});
