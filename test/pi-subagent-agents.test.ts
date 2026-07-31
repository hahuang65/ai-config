import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

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

test("inherits the CLI-selected model for Change review subagents", () => {
  const environment = {
    CHANGE_REVIEW_GATE: "1",
    CHANGE_REVIEW_SUBAGENT_MODEL: "openai/gpt-5",
  };

  expect(resolveAgentModel("change-reviewer", "opus", environment)).toBe("openai/gpt-5");
  expect(resolveAgentModel("database-reviewer", "opus", environment)).toBe("openai/gpt-5");
  expect(resolveAgentModel("change-fixer", "sonnet", environment)).toBe("sonnet");
});

test("uses the pi default model for CLI subagents without an override", () => {
  expect(resolveAgentModel("change-reviewer", "opus", { CHANGE_REVIEW_GATE: "1" })).toBeUndefined();
  expect(resolveAgentModel("change-reviewer", "opus", {})).toBe("opus");
});

test("the runtime adapter imports the installed TypeScript helper", () => {
  const adapter = readFileSync(new URL("../harnesses/pi/extensions/subagent/agents.ts", import.meta.url), "utf8");

  expect(adapter).toContain('from "./tool-names.ts"');
  expect(adapter).toContain('from "./model-selection.ts"');
  expect(adapter).not.toContain('from "./tool-names.js"');
});
