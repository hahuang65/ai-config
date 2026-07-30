import { describe, expect, test } from "bun:test";

await import("../../skills/review-artifact/runtime/assets/layout-audit.js");

const audit = (globalThis as typeof globalThis & { ReviewArtifactLayout: any }).ReviewArtifactLayout;

describe("review artifact layout audit", () => {
  test("reports meaningful content that materially escapes the viewport", () => {
    expect(
      audit.classifyRectEscape({
        rect: { left: 20, right: 920, top: 20, bottom: 80 },
        viewportWidth: 800,
        meaningful: true,
      }),
    ).toEqual({ kind: "escaped-content", axis: "horizontal", overflowPx: 120 });
  });

  test("ignores explicit ellipsis while reporting unintentional clipped text", () => {
    const base = {
      scrollWidth: 300,
      clientWidth: 100,
      scrollHeight: 20,
      clientHeight: 20,
      style: { overflowX: "hidden", overflowY: "visible", whiteSpace: "normal", webkitLineClamp: "none" },
    };

    expect(audit.classifyTextOverflow({ ...base, style: { ...base.style, textOverflow: "ellipsis" } })).toBeNull();
    expect(audit.classifyTextOverflow({ ...base, style: { ...base.style, textOverflow: "clip" } })).toEqual({
      kind: "clipped-text",
      axis: "horizontal",
      overflowPx: 200,
    });
  });

  test("reports a required control only when it is almost entirely occluded", () => {
    expect(audit.classifyOcclusion({ required: true, coveredSamples: 4, totalSamples: 5 })).toEqual({
      kind: "occluded-control",
      overflowPx: 0,
    });
    expect(audit.classifyOcclusion({ required: true, coveredSamples: 2, totalSamples: 5 })).toBeNull();
  });

  test("does not mistake an absent line-clamp property for intentional truncation", () => {
    expect(
      audit.classifyTextOverflow({
        scrollWidth: 300,
        clientWidth: 100,
        scrollHeight: 20,
        clientHeight: 20,
        style: { overflowX: "hidden", overflowY: "visible", whiteSpace: "normal", textOverflow: "clip" },
      }),
    ).toEqual({ kind: "clipped-text", axis: "horizontal", overflowPx: 200 });
  });
});
