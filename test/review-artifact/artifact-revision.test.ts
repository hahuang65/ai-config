import { expect, test } from "bun:test";

import { compareArtifactRevisions } from "../../skills/review-artifact/runtime/assets/artifact-revision.js";

test("stops before returning more changed regions than the display limit", () => {
  const previous = revision(Array.from({ length: 51 }, (_, index) => ({
    path: [index], tag: "p", directText: `Draft ${index}`,
  })));
  const current = revision(Array.from({ length: 51 }, (_, index) => ({
    path: [index], tag: "p", directText: `Revised ${index}`,
  })));

  expect(() => compareArtifactRevisions(previous, current)).toThrow(
    "Artifact revision exceeded the regions limit",
  );
});

test("stops matching and reorder work at explicit limits", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
  ]);

  expect(() => compareArtifactRevisions(previous, current, { matchingWork: 1 })).toThrow(
    "Artifact revision exceeded the matchingWork limit",
  );
  expect(() => compareArtifactRevisions(previous, current, { reorderWork: 1 })).toThrow(
    "Artifact revision exceeded the reorderWork limit",
  );
});

test("uses unique structural text anchors when an insertion shifts paths", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "p", directText: "Alpha" },
    { path: [0, 1], tag: "p", directText: "Beta" },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "p", directText: "New" },
    { path: [0, 1], tag: "p", directText: "Alpha" },
    { path: [0, 2], tag: "p", directText: "Beta" },
  ]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "added", path: [0, 0] },
  ]);
});

test("marks the closest unambiguous container when repeated identity is ambiguous", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "article", directText: "First", identity: { sliceId: "duplicate" } },
    { path: [0, 1], tag: "article", directText: "Second", identity: { sliceId: "duplicate" } },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "article", directText: "Second", identity: { sliceId: "duplicate" } },
    { path: [0, 1], tag: "article", directText: "First", identity: { sliceId: "duplicate" } },
  ]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "updated", path: [0] },
  ]);
});

test("combines Updated and moved for a reordered content change", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "article", directText: "Alpha", identity: { id: "alpha" } },
    { path: [0, 1], tag: "article", directText: "Beta", identity: { id: "beta" } },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "article", directText: "Beta revised", identity: { id: "beta" } },
    { path: [0, 1], tag: "article", directText: "Alpha", identity: { id: "alpha" } },
  ]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "updated-moved", path: [0, 0] },
    { kind: "moved", path: [0, 1] },
  ]);
});

test("matches unique IDs and task metadata before path when siblings reorder", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "article", directText: "Overview", identity: { id: "overview" } },
    { path: [0, 1], tag: "article", directText: "Slice five", identity: { sliceId: "S05" } },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "article", directText: "Slice five", identity: { sliceId: "S05" } },
    { path: [0, 1], tag: "article", directText: "Overview", identity: { id: "overview" } },
  ]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "moved", path: [0, 0] },
    { kind: "moved", path: [0, 1] },
  ]);
});

test("ignores geometry and rendered pixel fields outside the revision contract", () => {
  const previous = {
    version: 1,
    elements: [{ path: [0], tag: "canvas", directText: "", geometry: { width: 200 }, pixels: "red" }],
  };
  const current = {
    version: 1,
    elements: [{ path: [0], tag: "canvas", directText: "", geometry: { width: 300 }, pixels: "blue" }],
  };

  expect(compareArtifactRevisions(previous, current)).toEqual([]);
});

test("returns Updated when bounded visible styles change", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    {
      path: [0],
      tag: "p",
      directText: "Status",
      computedStyles: { color: "rgb(54, 95, 120)", fontWeight: "400", width: "200px" },
    },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    {
      path: [0],
      tag: "p",
      directText: "Status",
      computedStyles: { color: "rgb(169, 79, 50)", fontWeight: "700", width: "240px" },
    },
  ]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "updated", path: [0] },
  ]);
});

test("returns Updated when review status changes", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    {
      path: [0],
      tag: "article",
      directText: "Implementation slice",
      attributes: { "data-status": "pending" },
    },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    {
      path: [0],
      tag: "article",
      directText: "Implementation slice",
      attributes: { "data-status": "complete" },
    },
  ]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "updated", path: [0] },
  ]);
});

test("reduces a removed subtree to one page marker without deleted text", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "h1", directText: "Removed section" },
    { path: [0, 1], tag: "p", directText: "Deleted private copy" },
  ]);
  const current = revision([{ path: [], tag: "body", directText: "" }]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "removed", path: [] },
  ]);
});

test("anchors Removed content to the nearest surviving container", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "h1", directText: "Summary" },
    { path: [0, 1], tag: "p", directText: "Delete this note" },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "h1", directText: "Summary" },
  ]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "removed", path: [0] },
  ]);
});

test("returns Added for a newly visible semantic element", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "h1", directText: "Summary" },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "h1", directText: "Summary" },
    { path: [0, 1], tag: "p", directText: "New review note" },
  ]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "added", path: [0, 1] },
  ]);
});

test("returns only the smallest element whose direct text changed", () => {
  const previous = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "h1", directText: "Summary" },
    { path: [0, 1], tag: "p", directText: "Draft" },
  ]);
  const current = revision([
    { path: [], tag: "body", directText: "" },
    { path: [0], tag: "main", directText: "" },
    { path: [0, 0], tag: "h1", directText: "Summary" },
    { path: [0, 1], tag: "p", directText: "Revised" },
  ]);

  expect(compareArtifactRevisions(previous, current)).toEqual([
    { kind: "updated", path: [0, 1] },
  ]);
});

function revision(elements: Array<{
  path: number[];
  tag: string;
  directText: string;
  attributes?: Record<string, string>;
  computedStyles?: Record<string, string>;
  identity?: { id?: string; sliceId?: string; criterionId?: string };
}>) {
  return { version: 1, elements };
}
