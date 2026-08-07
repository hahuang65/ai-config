import { test, expect } from "bun:test";
import { findFloorGaps, formatMatrix, floorPolicies, type Coverage } from "../shared/conformance";
import { POLICIES } from "../shared/policy-registry";
import { evaluate, type ToolCall } from "../shared/guard-core";
import piGuard from "../harnesses/pi/extensions/guard-policies";
import { evaluateClaudePayload } from "../harnesses/claude/hooks/guard-verdict";

const HARNESSES = ["pi", "Claude Code"];

// The conformance probe for each policy is its registry `example` — no
// separate map to drift from the registry.

// Drive pi's in-process default export through its tool_call adapter shape.
function inProcessBlocks(guard: (pi: unknown) => void, call: ToolCall): boolean {
  let handler: ((e: unknown, ctx: unknown) => any) | undefined;
  guard({ on: (n: string, f: any) => { if (n === "tool_call") handler = f; } });
  const verdict = handler!(
    { toolName: call.tool, input: { command: call.command, path: call.path, content: call.content } },
    { cwd: call.cwd },
  );
  return !!(verdict && verdict.block);
}

// Claude Code (tier B): exercise the same normalization used by the command
// hook. A separate smoke test retains real stdin/stdout transport evidence.
async function claudeBlocks(call: ToolCall): Promise<boolean> {
  const verdict = evaluateClaudePayload({
    cwd: call.cwd,
    tool_name: call.tool,
    tool_input: { command: call.command, file_path: call.path, content: call.content },
  });
  return verdict?.hookSpecificOutput.permissionDecision === "deny";
}

const ADAPTERS = [
  { name: "pi", blocks: async (c: ToolCall) => inProcessBlocks(piGuard, c) },
  { name: "Claude Code", blocks: claudeBlocks },
];

async function liveCoverage(): Promise<Coverage> {
  const coverage: Coverage = {};
  for (const policy of POLICIES) {
    coverage[policy.id] = {};
    for (const adapter of ADAPTERS) {
      coverage[policy.id][adapter.name] = await adapter.blocks(policy.example);
    }
  }
  return coverage;
}

test("every harness blocks an unscoped branch switch beneath Orchard", async () => {
  const call: ToolCall = {
    tool: "bash",
    command: "git switch accidental-branch",
    cwd: "/home/example/.orchard/alpha/task",
  };

  expect(evaluate(call)?.policy).toBe("no-orchard-branch-binding-change");
  for (const adapter of ADAPTERS) {
    expect(await adapter.blocks(call), `${adapter.name} should block the branch switch`).toBe(true);
  }
});

test("every policy's example violates it and its counter-example does not", () => {
  // The registry pins both sides of each policy's boundary; the core agrees.
  for (const policy of POLICIES) {
    expect(evaluate(policy.example)?.policy, `${policy.id}: example should violate ${policy.id}`).toBe(policy.id);
    expect(evaluate(policy.counterExample)?.policy, `${policy.id}: counter-example should not trip ${policy.id}`).not.toBe(policy.id);
  }
});

test("every harness enforces every floor policy", async () => {
  // Derive the harness list from the adapters under test so coverage and the
  // gap analysis can never silently diverge (e.g. when pi is promoted).
  const names = ADAPTERS.map((a) => a.name);
  const coverage = await liveCoverage();
  console.log("\n" + formatMatrix(coverage, names) + "\n");
  expect(findFloorGaps(coverage, names)).toEqual([]);
});

test("the coverage matrix labels floor policies and lists every harness", () => {
  const coverage = { "no-secret-access": { pi: true, "Claude Code": true } };
  const matrix = formatMatrix(coverage, HARNESSES);
  expect(matrix).toContain("no-secret-access");
  expect(matrix).toContain("floor");
  expect(matrix).toContain("Claude Code");
});

test("reports a floor policy left uncovered by a harness", () => {
  const coverage = { "no-secret-access": { pi: true, "Claude Code": false } };
  const gaps = findFloorGaps(coverage, HARNESSES);
  expect(gaps).toContainEqual({ policy: "no-secret-access", harness: "Claude Code" });
});

test("does not report an uncovered non-floor policy as a gap", () => {
  // Every floor policy covered; a non-floor policy left uncovered.
  const coverage: Coverage = {};
  for (const policy of floorPolicies()) {
    coverage[policy.id] = { pi: true, "Claude Code": true };
  }
  coverage["no-shell-write"] = { pi: false, "Claude Code": false };
  expect(findFloorGaps(coverage, HARNESSES)).toEqual([]);
});
