import { expect, test } from "bun:test";

const {
  appendPrompt,
  validateChatEntries,
  validateFrameMessage,
  validateShellMessage,
  validateStoredQueue,
} = await import("../../skills/review-artifact/runtime/assets/message-validation.js");

test("rejects cyclic revision payloads without throwing", () => {
  const revision: Record<string, unknown> = { version: 1, elements: [] };
  revision.cycle = revision;

  expect(() => validateFrameMessage({
    type: "review:artifact-revision",
    generation: 1,
    revision,
  })).not.toThrow();
  expect(validateFrameMessage({
    type: "review:artifact-revision",
    generation: 1,
    revision,
  })).toBeNull();
});

test("rejects malformed and oversized frame messages", () => {
  expect([
    validateFrameMessage({ type: "review:queue", prompt: null }),
    validateFrameMessage({
      type: "review:queue",
      prompt: { prompt: "x".repeat(10_001), tag: "main" },
    }),
    validateFrameMessage({
      type: "review:queue",
      prompt: {
        prompt: "Invalid range",
        target: {
          type: "text-range",
          text: "x",
          selector: "main",
          start: { selector: "main", path: [0], offset: Number.MAX_SAFE_INTEGER },
          end: { selector: "main", path: [0], offset: Number.MAX_SAFE_INTEGER },
        },
      },
    }),
  ]).toEqual([null, null, null]);
});

test("accepts only bounded artifact document titles", () => {
  expect(validateFrameMessage({
    type: "review:ready",
    title: "Overnight Runner - Review Findings",
  })).toEqual({ type: "review:ready", title: "Overnight Runner - Review Findings" });
  expect(validateFrameMessage({ type: "review:ready", title: "x".repeat(2_001) })).toEqual({
    type: "review:ready",
  });
});

test("accepts a bounded artifact form submission", () => {
  expect(validateFrameMessage({
    type: "review:submit",
    prompt: {
      prompt: '{"action":"fix-selected","selectedFindingIds":["review-1"]}',
      selector: "#review-decisions",
      tag: "review-decisions",
      text: "Review decisions",
    },
  })).toEqual({
    type: "review:submit",
    prompt: {
      prompt: '{"action":"fix-selected","selectedFindingIds":["review-1"]}',
      selector: "#review-decisions",
      tag: "review-decisions",
      text: "Review decisions",
      displayText: "Review decisions",
    },
  });
});

test("preserves a bounded text-range annotation", () => {
  expect(validateFrameMessage({
    type: "review:queue",
    prompt: {
      prompt: "Tighten this copy",
      selector: "main > p",
      tag: "text",
      text: "Current copy",
      target: {
        type: "text-range",
        text: "Current copy",
        selector: "main > p",
        start: { selector: "main > p", path: [0], offset: 0 },
        end: { selector: "main > p", path: [0], offset: 12 },
      },
    },
  })).toMatchObject({
    type: "review:queue",
    prompt: { prompt: "Tighten this copy", target: { type: "text-range" } },
  });
});

test("accepts bounded failure messages and rejects unknown change messages", () => {
  expect([
    validateFrameMessage({
      type: "review:artifact-revision-failed",
      generation: 2,
      status: "unavailable",
    }),
    validateFrameMessage({
      type: "review:artifact-revision-failed",
      generation: -1,
      status: "unknown",
    }),
    validateShellMessage({
      type: "review:unknown-change-command",
      comparisonId: 1,
      generation: 2,
    }),
  ]).toEqual([
    { type: "review:artifact-revision-failed", generation: 2, status: "unavailable" },
    null,
    null,
  ]);
});

test("accepts only bounded artifact revision messages", () => {
  const revision = {
    version: 1,
    elements: [{ path: [0, 1], tag: "p", directText: "Revised" }],
  };
  expect([
    validateFrameMessage({ type: "review:artifact-revision", generation: 0, revision }),
    validateFrameMessage({ type: "review:artifact-revision", generation: Number.MAX_SAFE_INTEGER, revision }),
    validateFrameMessage({ type: "review:artifact-revision", generation: 0, revision: { ...revision, version: 2 } }),
    validateShellMessage({
      type: "review:present-changed-regions",
      comparisonId: 1,
      generation: 0,
      regions: [{ kind: "updated", path: [0, 1] }],
    }),
  ]).toEqual([
    { type: "review:artifact-revision", generation: 0, revision },
    null,
    null,
    {
      type: "review:present-changed-regions",
      comparisonId: 1,
      generation: 0,
      regions: [{ kind: "updated", path: [0, 1] }],
    },
  ]);
});

test("discards invalid persisted queue entries", () => {
  expect(validateStoredQueue([null, { prompt: "Keep this", tag: "main" }])).toEqual([
    { prompt: "Keep this", selector: "", tag: "main", text: "" },
  ]);
});

test("discards malformed durable chat before reload rendering", () => {
  expect(validateChatEntries([
    { role: "agent", text: "Keep this" },
    { role: "user", text: "Broken", prompt: { target: { type: "text-range", text: {} } } },
  ])).toEqual([{ role: "agent", text: "Keep this" }]);
});

test("accepts only bounded artifact scroll reports", () => {
  expect([
    validateFrameMessage({ type: "review:scroll", x: 10, y: 400 }),
    validateFrameMessage({ type: "review:scroll", x: 0, y: Number.MAX_SAFE_INTEGER }),
  ]).toEqual([{ type: "review:scroll", x: 10, y: 400 }, null]);
});

test("rejects a live queue that exceeds count or byte limits", () => {
  const prompt = { prompt: "Keep this", selector: "", tag: "main", text: "" };
  const fullQueue = Array.from({ length: 100 }, () => prompt);
  const largeQueue = Array.from({ length: 12 }, () => ({
    ...prompt,
    prompt: "x".repeat(10_000),
  }));

  expect([
    appendPrompt(fullQueue, prompt),
    appendPrompt(largeQueue, prompt),
  ]).toEqual([null, null]);
});
