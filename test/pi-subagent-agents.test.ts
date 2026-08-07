import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import { resolveAgentModel } from "../harnesses/pi/extensions/subagent/model-selection";
import { parseAgentTools } from "../harnesses/pi/extensions/subagent/tool-names";

test("normalizes shared YAML agent tool arrays for pi subagents", () => {
  expect(parseAgentTools(["Read", "Write", "Bash", "Glob"])).toEqual(["read", "write", "bash", "find"]);
});

test("rejects unsupported-only and mixed tool declarations instead of enabling defaults", () => {
  expect(() => parseAgentTools(["WebFetch"])).toThrow("Unsupported pi subagent tools: WebFetch");
  expect(() => parseAgentTools(["Read", "WebSearch"])).toThrow("Unsupported pi subagent tools: WebSearch");
});

test("normalizes comma-separated tool declarations", () => {
  expect(parseAgentTools("Read, Grep, Glob")).toEqual(["read", "grep", "find"]);
});

test("inherits the CLI-selected model for Review change subagents", () => {
  const environment = {
    REVIEW_CHANGE_GATE: "1",
    REVIEW_CHANGE_SUBAGENT_MODEL: "openai/gpt-5",
  };

  expect(resolveAgentModel("change-reviewer", undefined, environment)).toBe("openai/gpt-5");
  expect(resolveAgentModel("database-reviewer", undefined, environment)).toBe("openai/gpt-5");
  expect(resolveAgentModel("change-fixer", "sonnet", environment)).toBe("sonnet");
});

test("uses the pi default model for Review change subagents without an override", () => {
  expect(resolveAgentModel("change-reviewer", undefined, { REVIEW_CHANGE_GATE: "1" })).toBeUndefined();
  expect(resolveAgentModel("change-reviewer", undefined, {})).toBeUndefined();
});

test("all shared agents use the harness default model", () => {
  const agentsDirectory = new URL("../agents/", import.meta.url);
  const agentsWithModels = readdirSync(agentsDirectory)
    .filter((fileName) => fileName.endsWith(".md"))
    .filter((fileName) => /^model:/m.test(readFileSync(new URL(fileName, agentsDirectory), "utf8")));

  expect(agentsWithModels).toEqual([]);
});

test("the pi manifest bounds relative executable traversal", () => {
  const manifest = readFileSync(new URL("../harnesses/pi/manifest.sh", import.meta.url), "utf8");

  expect(manifest).toContain('*) pi_real="$(pwd -P)/$pi_real" ;;');
  expect(manifest).toContain('[ "$parent" = "$dir" ] && break');
});

test("the runtime adapter imports the installed TypeScript helper", () => {
  const adapter = readFileSync(new URL("../harnesses/pi/extensions/subagent/agents.ts", import.meta.url), "utf8");

  expect(adapter).toContain('from "./tool-names.ts"');
  expect(adapter).toContain('from "./model-selection.ts"');
  expect(adapter).not.toContain('from "./tool-names.js"');
});
