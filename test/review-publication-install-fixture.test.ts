import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { isolatedInstallerEnvironment } from "./review-publication-install-fixture";

const repositoryRoot = path.resolve(import.meta.dir, "..");

test("isolated installer fixtures ignore the host listener by default", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-isolated-environment-"));
  try {
    const environment = await isolatedInstallerEnvironment({ home, repositoryRoot, platform: "Linux" });
    const portCheck = environment.AI_CONFIG_PORT_CHECK_BIN;
    if (!portCheck) throw new Error("The isolated fixture did not configure a port check");

    const processRef = Bun.spawn([portCheck, "4392"], { stdout: "ignore", stderr: "pipe" });
    const [status, stderr] = await Promise.all([
      processRef.exited,
      new Response(processRef.stderr).text(),
    ]);

    expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("listener ownership tests can override the isolated port result", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-explicit-environment-"));
  try {
    const explicitPortCheck = path.join(home, "explicit-port-check");
    const environment = await isolatedInstallerEnvironment({
      home,
      repositoryRoot,
      platform: "Darwin",
      additionalEnvironment: { AI_CONFIG_PORT_CHECK_BIN: explicitPortCheck },
    });

    expect(environment.AI_CONFIG_PORT_CHECK_BIN).toBe(explicitPortCheck);
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});
