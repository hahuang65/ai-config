import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateManagedPublicationState } from "../review-publication/check-managed-state.mjs";
import { loadPublicationKey } from "../skills/review-change/runtime/review-publication-state.mjs";
import {
  isolatedInstallerEnvironment,
  type FixtureServicePlatform,
} from "./review-publication-install-fixture";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

test("failed upgrades preserve every managed file and the signing key", async () => {
  const cases = [
    {
      name: "port 4392 is already owned",
      platform: "Linux",
      environment: async (home: string) => ({
        AI_CONFIG_PORT_CHECK_BIN: await fakeExecutable(home, "port-conflict", "console.error('Review publication cannot use 127.0.0.1:4392 because the port is already owned. Stop the conflicting user service, then try again.'); process.exit(1)"),
      }),
      message: "port is already owned",
    },
    {
      name: "confirmation UI is unavailable",
      platform: "Linux",
      environment: async (home: string) => ({ AI_CONFIG_CONFIRMATION_BIN: path.join(home, "missing-zenity") }),
      message: "zenity is not an executable file",
    },
    {
      name: "platform is unsupported",
      platform: "Plan9",
      environment: async () => ({ AI_CONFIG_SERVICE_ENABLE: "true" }),
      message: "Plan9 is unsupported",
    },
  ];
  for (const fixture of cases) {
    const home = await mkdtemp(path.join(tmpdir(), "review-publication-preserve-"));
    try {
      expect(await runInstaller(home, "Linux")).toEqual({ status: 0, stderr: "" });
      await loadPublicationKey({ home });
      const before = await managedInstallationSnapshot(home);
      const installation = await runInstaller(home, fixture.platform, await fixture.environment(home));

      expect({
        name: fixture.name,
        status: installation.status,
        corrective: installation.stderr.includes(fixture.message),
        preserved: await managedInstallationSnapshot(home),
      }).toEqual({ name: fixture.name, status: 1, corrective: true, preserved: before });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  }
});

test("preflights a failed managed-file upgrade before replacing any prior file", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-preflight-upgrade-"));
  try {
    expect(await runInstaller(home, "Linux")).toEqual({ status: 0, stderr: "" });
    await loadPublicationKey({ home });
    const service = path.join(home, ".config", "systemd", "user", "review-publication@.service");
    await writeFile(service, "unrelated service state\n");
    const before = await managedInstallationSnapshot(home);

    const installation = await runInstaller(home, "Linux");

    expect({
      status: installation.status,
      corrective: installation.stderr.includes("destination is not managed"),
      preserved: await managedInstallationSnapshot(home),
    }).toEqual({ status: 1, corrective: true, preserved: before });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("rejects symlinked managed state without changing its prior files or signing key", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-state-link-install-"));
  const originalState = path.join(home, ".review-publication");
  const movedState = path.join(home, "prior-review-publication-state");
  try {
    expect(await runInstaller(home, "Linux")).toEqual({ status: 0, stderr: "" });
    await loadPublicationKey({ home });
    const before = await managedInstallationSnapshot(home);
    await rename(originalState, movedState);
    await symlink(movedState, originalState);

    const installation = await runInstaller(home, "Linux");

    expect({
      status: installation.status,
      corrective: installation.stderr.includes("must not be a symbolic link"),
      preserved: await managedInstallationSnapshot(home),
    }).toEqual({ status: 1, corrective: true, preserved: before });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("reports unsafe managed-state ownership through an injected deterministic check", async () => {
  await expect(validateManagedPublicationState({
    home: "/home/reviewer",
    userId: 501,
    lstat: async () => ({
      isDirectory: () => true,
      isSymbolicLink: () => false,
      uid: 777,
    }) as any,
  })).rejects.toThrow("Restore ownership to the current user");
});

async function fakeExecutable(home: string, name: string, statement: string) {
  const executable = path.join(home, name);
  await writeFile(executable, `#!${process.execPath}\n${statement}\n`);
  await chmod(executable, 0o700);
  return executable;
}

async function managedInstallationSnapshot(home: string) {
  const paths = [
    path.join(".review-publication", "review-publication-worker.mjs"),
    path.join(".review-publication", "worker-config.json"),
    path.join(".review-publication", "signing-key"),
    path.join(".local", "bin", "review-publication"),
    path.join(".config", "systemd", "user", "review-publication.socket"),
    path.join(".config", "systemd", "user", "review-publication@.service"),
  ];
  return Object.fromEntries(await Promise.all(paths.map(async (relative) => [
    relative,
    (await readFile(path.join(home, relative))).toString("base64"),
  ])));
}

async function runInstaller(
  home: string,
  platform: FixtureServicePlatform,
  additionalEnvironment: Record<string, string> = {},
) {
  const environment = await isolatedInstallerEnvironment({
    home,
    repositoryRoot,
    platform,
    additionalEnvironment,
  });
  const processRef = Bun.spawn(["bash", path.join(repositoryRoot, "review-publication", "install.sh")], {
    env: environment,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stderr] = await Promise.all([
    processRef.exited,
    new Response(processRef.stderr).text(),
  ]);
  return { status, stderr };
}
