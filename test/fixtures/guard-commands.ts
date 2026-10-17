import { expect } from "bun:test";
import { evaluateClaudePayload } from "../../harnesses/claude/guard-verdict";
import { createGuardPoliciesExtension } from "../../harnesses/pi/guard-policies";
import bundledGuard from "../../harnesses/pi/guard-policies.bundle";
import { initializeShellParser } from "../../guard/shell-parser";

const home = "/home/disposable-user";

// These are guard inputs only: no command under test is ever executed.
export async function expectBlocked(command: string, blocked: boolean, cwd = "/tmp/project") {
  expect(await initializeShellParser()).toBe(true);
  let inspect: any;
  createGuardPoliciesExtension({ environmentHome: home, platformHome: home })({
    on(event: string, handler: any) { if (event === "tool_call") inspect = handler; },
  } as any);
  const claude = evaluateClaudePayload({ tool_name: "Bash", tool_input: { command }, cwd },
    { environmentHome: home, platformHome: home });
  const pi = await inspect({ toolName: "bash", input: { command } }, { cwd });
  expect({ command, blocked: claude?.hookSpecificOutput.permissionDecision === "deny" }).toEqual({ command, blocked });
  expect({ command, blocked: pi?.block === true }).toEqual({ command, blocked });
  let inspectBundle: any;
  bundledGuard({ on(event: string, handler: any) { if (event === "tool_call") inspectBundle = handler; } } as any);
  const bundled = await inspectBundle({ toolName: "bash", input: { command } }, { cwd });
  expect({ command, blocked: bundled?.block === true }).toEqual({ command, blocked });
}
