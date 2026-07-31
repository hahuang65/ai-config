import { describe, expect, test } from "bun:test";

import { registerChangeReviewProgress } from "../harnesses/pi/extensions/change-review-progress.ts";

describe("Change review progress extension", () => {
  test("registers progress telemetry only inside the standalone gate", async () => {
    const inactiveTools: any[] = [];
    const activeTools: any[] = [];

    expect(registerChangeReviewProgress({ registerTool: (tool: any) => inactiveTools.push(tool) } as any, {})).toBe(false);
    expect(registerChangeReviewProgress(
      { registerTool: (tool: any) => activeTools.push(tool) } as any,
      { CHANGE_REVIEW_GATE: "1" },
    )).toBe(true);
    expect(inactiveTools).toEqual([]);
    expect(activeTools).toHaveLength(1);
    expect(activeTools[0].name).toBe("change_review_status");
    expect(activeTools[0].parameters.properties.action.enum).toContain("step");
    expect(activeTools[0].promptGuidelines.join(" ")).toContain("no more than six words");
    expect(activeTools[0].promptGuidelines.join(" ")).toContain("one log call");
    expect(activeTools[0].promptGuidelines.join(" ")).toContain("never combine or summarize collected items");
    expect((await activeTools[0].execute("id", {
      stage: "review",
      action: "step",
      message: "Tracing changed interfaces and callers",
    })).details).toEqual({ stage: "review", action: "step" });
  });
});
