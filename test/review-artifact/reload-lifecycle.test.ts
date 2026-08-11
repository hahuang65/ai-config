import { expect, test } from "bun:test";

import { ArtifactRevisionLimitError } from "../../skills/review-artifact/runtime/assets/artifact-revision.js";
import {
  createBrowserReloadController,
  createReloadLifecycleCoordinator,
} from "../../skills/review-artifact/runtime/assets/change-session.js";

test("resets the baseline after failed capture before later comparisons resume", () => {
  const lifecycle = createReloadLifecycleCoordinator();
  lifecycle.accept({ type: "frame-settled", generation: 0, revision: revision("Draft") });
  lifecycle.accept({ type: "reload-requested" });
  const failed = lifecycle.accept({ type: "frame-failed", generation: 1, status: "unavailable" });
  lifecycle.accept({ type: "reload-requested" });
  const recoveredBaseline = lifecycle.accept({ type: "frame-settled", generation: 2, revision: revision("Recovered") });
  lifecycle.accept({ type: "reload-requested" });
  const resumed = lifecycle.accept({ type: "frame-settled", generation: 3, revision: revision("Final") });

  expect({ failed, recoveredBaseline, resumed }).toMatchObject({
    failed: [{ type: "present-comparison-status", generation: 1, status: "unavailable" }],
    recoveredBaseline: [{ type: "clear-comparison-presentation", generation: 2 }],
    resumed: [{
      type: "compare-revisions",
      generation: 3,
      previousRevision: revision("Recovered"),
      currentRevision: revision("Final"),
    }],
  });
});

test("replaces stale comparison presentation when bounded comparison overflows", () => {
  const presentations: unknown[] = [];
  let comparisonCount = 0;
  const controller = createBrowserReloadController({
    compare: () => {
      comparisonCount += 1;
      if (comparisonCount === 2) throw new ArtifactRevisionLimitError("matchingWork");
      return [{ kind: "updated", path: [0] }];
    },
    navigate: () => {},
    present: (presentation: unknown) => presentations.push(presentation),
  });

  controller.accept({ type: "frame-settled", generation: 0, revision: revision("Draft") });
  controller.accept({ type: "reload-requested" });
  controller.accept({ type: "frame-settled", generation: 1, revision: revision("Revised") });
  controller.accept({ type: "reload-requested" });
  controller.accept({ type: "frame-settled", generation: 2, revision: revision("Oversized") });

  expect(presentations).toEqual([
    {
      type: "present-comparison",
      comparisonId: 1,
      generation: 1,
      regions: [{ kind: "updated", path: [0] }],
    },
    {
      type: "present-comparison-status",
      comparisonId: 2,
      generation: 2,
      status: "limited",
    },
  ]);
});

test("clears an unchanged comparison and promotes it as the next baseline", () => {
  const comparisons: Array<{ previous: unknown; current: unknown }> = [];
  const presentations: unknown[] = [];
  const controller = createBrowserReloadController({
    compare: (previous: ReturnType<typeof revision>, current: ReturnType<typeof revision>) => {
      comparisons.push({ previous, current });
      return previous.elements[0].directText === current.elements[0].directText
        ? []
        : [{ kind: "updated", path: [0] }];
    },
    navigate: () => {},
    present: (presentation: unknown) => presentations.push(presentation),
  });

  controller.accept({ type: "frame-settled", generation: 0, revision: revision("Draft") });
  for (const copy of ["Revised", "Revised", "Final"]) {
    controller.accept({ type: "reload-requested" });
    controller.accept({
      type: "frame-settled",
      generation: comparisons.length + 1,
      revision: revision(copy),
    });
  }

  expect({ comparisons, presentations }).toMatchObject({
    comparisons: [
      { previous: revision("Draft"), current: revision("Revised") },
      { previous: revision("Revised"), current: revision("Revised") },
      { previous: revision("Revised"), current: revision("Final") },
    ],
    presentations: [
      { regions: [{ kind: "updated", path: [0] }] },
      { regions: [] },
      { regions: [{ kind: "updated", path: [0] }] },
    ],
  });
});

test("ignores a comparison result superseded by another reload", () => {
  const baseline = revision("Draft");
  const lifecycle = createReloadLifecycleCoordinator();
  lifecycle.accept({ type: "frame-settled", generation: 0, revision: baseline });
  lifecycle.accept({ type: "reload-requested" });
  lifecycle.accept({ type: "frame-settled", generation: 1, revision: revision("Intermediate") });
  lifecycle.accept({ type: "reload-requested" });

  const lateResult = lifecycle.accept({
    type: "comparison-finished",
    comparisonId: 1,
    generation: 1,
    regions: [{ kind: "updated", path: [0] }],
  });
  const nextComparison = lifecycle.accept({
    type: "frame-settled",
    generation: 2,
    revision: revision("Newest"),
  });

  expect({ lateResult, nextComparison }).toMatchObject({
    lateResult: [],
    nextComparison: [{
      type: "compare-revisions",
      generation: 2,
      previousRevision: baseline,
      currentRevision: revision("Newest"),
    }],
  });
});

test("presents an accepted comparison and promotes its revision", () => {
  const baseline = revision("Draft");
  const first = revision("First");
  const second = revision("Second");
  const lifecycle = createReloadLifecycleCoordinator();
  lifecycle.accept({ type: "frame-settled", generation: 0, revision: baseline });
  lifecycle.accept({ type: "reload-requested" });
  lifecycle.accept({ type: "frame-settled", generation: 1, revision: first });

  const presented = lifecycle.accept({
    type: "comparison-finished",
    comparisonId: 1,
    generation: 1,
    regions: [{ kind: "updated", path: [0] }],
  });
  lifecycle.accept({ type: "reload-requested" });
  const nextComparison = lifecycle.accept({ type: "frame-settled", generation: 2, revision: second });

  expect({ presented, nextComparison }).toEqual({
    presented: [{
      type: "present-comparison",
      comparisonId: 1,
      generation: 1,
      regions: [{ kind: "updated", path: [0] }],
    }],
    nextComparison: [{
      type: "compare-revisions",
      comparisonId: 2,
      generation: 2,
      previousRevision: first,
      currentRevision: second,
    }],
  });
});

test("ignores a settled result from a superseded generation", () => {
  const lifecycle = createReloadLifecycleCoordinator();
  lifecycle.accept({ type: "frame-settled", generation: 0, revision: revision("Draft") });
  lifecycle.accept({ type: "reload-requested" });
  lifecycle.accept({ type: "reload-requested" });
  lifecycle.accept({ type: "frame-settled", generation: 1, revision: revision("Intermediate") });

  expect(lifecycle.accept({
    type: "frame-settled",
    generation: 1,
    revision: revision("Late intermediate"),
  })).toEqual([]);
});

test("coalesces rapid reloads into one comparison with the newest settled frame", () => {
  const baseline = revision("Draft");
  const intermediate = revision("Intermediate");
  const newest = revision("Newest");
  const lifecycle = createReloadLifecycleCoordinator();

  lifecycle.accept({ type: "frame-settled", generation: 0, revision: baseline });
  const actions = [
    ...lifecycle.accept({ type: "reload-requested" }),
    ...lifecycle.accept({ type: "reload-requested" }),
    ...lifecycle.accept({ type: "reload-requested" }),
    ...lifecycle.accept({ type: "frame-settled", generation: 1, revision: intermediate }),
    ...lifecycle.accept({ type: "frame-settled", generation: 2, revision: newest }),
  ];

  expect(actions).toEqual([
    { type: "navigate-frame", generation: 1 },
    { type: "navigate-frame", generation: 2 },
    {
      type: "compare-revisions",
      comparisonId: 1,
      generation: 2,
      previousRevision: baseline,
      currentRevision: newest,
    },
  ]);
});

function revision(copy: string) {
  return { version: 1, elements: [{ path: [0], tag: "p", directText: copy }] };
}
