import { test, expect } from "bun:test";
import { findFloorGaps, formatMatrix, floorPolicies, type Coverage } from "../shared/conformance";
import { POLICIES } from "../shared/policy-registry";
import { evaluate, type ToolCall } from "../shared/guard-core";
import ompGuard from "../harnesses/omp/hooks/pre/guard-policies";

const HARNESSES = ["oh-my-pi", "Claude Code"];

// The conformance probe for each policy is its registry `example` — no
// separate map to drift from the registry.

// oh-my-pi (tier A): drive the in-process adapter directly.
function ompBlocks(call: ToolCall): boolean {
  let handler: ((e: unknown) => any) | undefined;
  ompGuard({ on: (n: string, f: any) => { if (n === "tool_call") handler = f; } } as any);
  const verdict = handler!({ toolName: call.tool, input: { command: call.command, path: call.path } });
  return !!(verdict && verdict.block);
}

// Claude Code (tier B): drive the command-hook shim over stdin/stdout.
async function claudeBlocks(call: ToolCall): Promise<boolean> {
  const payload = { tool_name: call.tool, tool_input: { command: call.command, file_path: call.path } };
  const proc = Bun.spawn(["bun", `${import.meta.dir}/../harnesses/claude/hooks/guard.ts`], {
    stdin: Buffer.from(JSON.stringify(payload)),
    stdout: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await proc.exited;
  return out.includes('"permissionDecision":"deny"');
}

const ADAPTERS = [
  { name: "oh-my-pi", blocks: async (c: ToolCall) => ompBlocks(c) },
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
  const coverage = { "no-secret-access": { "oh-my-pi": true, "Claude Code": true } };
  const matrix = formatMatrix(coverage, HARNESSES);
  expect(matrix).toContain("no-secret-access");
  expect(matrix).toContain("floor");
  expect(matrix).toContain("Claude Code");
});

test("reports a floor policy left uncovered by a harness", () => {
  const coverage = { "no-secret-access": { "oh-my-pi": true, "Claude Code": false } };
  const gaps = findFloorGaps(coverage, HARNESSES);
  expect(gaps).toContainEqual({ policy: "no-secret-access", harness: "Claude Code" });
});

test("does not report an uncovered non-floor policy as a gap", () => {
  // Every floor policy covered; a non-floor policy left uncovered.
  const coverage: Coverage = {};
  for (const policy of floorPolicies()) {
    coverage[policy.id] = { "oh-my-pi": true, "Claude Code": true };
  }
  coverage["no-force-push"] = { "oh-my-pi": false, "Claude Code": false };
  expect(findFloorGaps(coverage, HARNESSES)).toEqual([]);
});
