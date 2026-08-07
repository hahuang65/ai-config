import { expect, test } from "bun:test";

import { createConcurrencyLimit } from "./concurrency-limit";

test("runs an exclusive task after active shared tasks and before later work", async () => {
  const withLimit = createConcurrencyLimit(3);
  const started: string[] = [];
  let releaseShared = () => {};
  let releaseExclusive = () => {};
  const sharedGate = new Promise<void>((resolve) => { releaseShared = resolve; });
  const exclusiveGate = new Promise<void>((resolve) => { releaseExclusive = resolve; });
  const first = withLimit(async () => { started.push("shared-a"); await sharedGate; });
  const second = withLimit(async () => { started.push("shared-b"); await sharedGate; });
  const exclusive = withLimit(async () => { started.push("exclusive"); await exclusiveGate; }, 3);
  const trailing = withLimit(async () => { started.push("trailing"); });

  await Promise.resolve();
  expect(started).toEqual(["shared-a", "shared-b"]);
  releaseShared();
  await Promise.all([first, second]);
  await Promise.resolve();
  expect(started).toEqual(["shared-a", "shared-b", "exclusive"]);
  releaseExclusive();
  await Promise.all([exclusive, trailing]);
  expect(started).toEqual(["shared-a", "shared-b", "exclusive", "trailing"]);
});
