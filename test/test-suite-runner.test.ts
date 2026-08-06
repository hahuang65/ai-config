import { expect, test } from "bun:test";

import { executeLanes, executePhases } from "../scripts/test-suite-runner.mjs";

const lanes = Object.freeze([
  Object.freeze({ name: "content" }),
  Object.freeze({ name: "install" }),
  Object.freeze({ name: "browser" }),
]);

test("starts every test lane without waiting for an earlier lane", async () => {
  const started: string[] = [];
  let releaseLanes = () => {};
  const held = new Promise<void>((resolve) => { releaseLanes = resolve; });
  const execution = executeLanes(lanes, async (lane) => {
    started.push(lane.name);
    await held;
    return { ...lane, exitCode: 0 };
  });

  await Promise.resolve();
  expect(started).toEqual(["content", "install", "browser"]);
  releaseLanes();
  await execution;
});

test("starts a later phase only after every earlier lane finishes", async () => {
  const started: string[] = [];
  let releaseFirstPhase = () => {};
  const held = new Promise<void>((resolve) => { releaseFirstPhase = resolve; });
  const phases = Object.freeze([lanes.slice(0, 2), lanes.slice(2)]);
  const execution = executePhases(phases, async (lane) => {
    started.push(lane.name);
    if (lane.name !== "browser") await held;
    return { ...lane, exitCode: 0 };
  });

  await Promise.resolve();
  expect(started).toEqual(["content", "install"]);
  releaseFirstPhase();
  await execution;
  expect(started).toEqual(["content", "install", "browser"]);
});

test("fails the suite when one concurrent lane fails", async () => {
  const outcome = await executeLanes(lanes, async (lane) => ({
    ...lane,
    exitCode: lane.name === "install" ? 1 : 0,
  }));

  expect(outcome.ok).toBe(false);
});
