import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SERVICE_SHUTDOWN_TIMEOUT_SECONDS,
  TOTAL_SERVICE_LIFETIME_SECONDS,
} from "../skills/review-change/runtime/review-publication-lifetime.mjs";
import { loadPublicationKey } from "../skills/review-change/runtime/review-publication-state.mjs";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

test("installs a dormant user socket without an always-running publisher", async () => {
  const [rootInstaller, publisherInstaller, launchd, socket, service] = await Promise.all([
    readFile(path.join(repositoryRoot, "install.sh"), "utf8"),
    readFile(path.join(repositoryRoot, "review-publication", "install.sh"), "utf8"),
    readFile(path.join(repositoryRoot, "review-publication", "dev.review-publication.plist"), "utf8"),
    readFile(path.join(repositoryRoot, "review-publication", "review-publication.socket"), "utf8"),
    readFile(path.join(repositoryRoot, "review-publication", "review-publication@.service"), "utf8"),
  ]);

  expect({
    delegated: rootInstaller.includes("review-publication/install.sh"),
    launchdSocket: launchd.includes("<key>Sockets</key>") && launchd.includes("<key>inetdCompatibility</key>"),
    launchdDormant: !launchd.includes("RunAtLoad") && !launchd.includes("KeepAlive"),
    systemdSocket: socket.includes("ListenStream=127.0.0.1:4392") && socket.includes("Accept=yes"),
    systemdWorker: service.includes("StandardInput=socket") && service.includes("StandardOutput=socket"),
    generatedWorkerLifetime:
      service.includes("RuntimeMaxSec=__SERVICE_LIFETIME_SECONDS__s")
      && service.includes("TimeoutStartSec=__SERVICE_LIFETIME_SECONDS__s")
      && service.includes("TimeoutStopSec=__SERVICE_SHUTDOWN_TIMEOUT_SECONDS__s"),
    macWorkerInterface: launchd.includes("<string>--inetd</string>") && !launchd.includes("__CONFIRMATION_EXECUTABLE__") && !launchd.includes("<string>macos</string>"),
    linuxWorkerInterface: service.includes("__WORKER__ --inetd") && !service.includes("__CONFIRMATION_EXECUTABLE__") && !service.includes("--inetd linux"),
    noServiceEnvironmentOverride: !launchd.includes("REVIEW_PUBLICATION_GH") && !service.includes("REVIEW_PUBLICATION_GH"),
    boundedMacShutdown: launchd.includes("<key>ExitTimeOut</key>")
      && launchd.includes("<integer>__SERVICE_SHUTDOWN_TIMEOUT_SECONDS__</integer>"),
    noRestart: !service.includes("Restart="),
    installerEnablesSocket: publisherInstaller.includes("review-publication.socket"),
  }).toEqual({
    delegated: true,
    launchdSocket: true,
    launchdDormant: true,
    systemdSocket: true,
    systemdWorker: true,
    generatedWorkerLifetime: true,
    macWorkerInterface: true,
    linuxWorkerInterface: true,
    noServiceEnvironmentOverride: true,
    boundedMacShutdown: true,
    noRestart: true,
    installerEnablesSocket: true,
  });
});

test("repeated installation preserves the signing key without activating under a projected home", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-install-"));
  try {
    const install = async () => {
      const processRef = Bun.spawn(["bash", path.join(repositoryRoot, "review-publication", "install.sh")], {
        env: {
          ...process.env,
          HOME: home,
          AI_CONFIG_REPO_DIR: repositoryRoot,
          AI_CONFIG_SERVICE_ENABLE: "false",
          AI_CONFIG_SERVICE_PLATFORM: "Linux",
          AI_CONFIG_NODE_BIN: process.execPath,
          AI_CONFIG_GH_BIN: process.execPath,
          AI_CONFIG_CONFIRMATION_BIN: process.execPath,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [status, stderr] = await Promise.all([
        processRef.exited,
        new Response(processRef.stderr).text(),
      ]);
      expect({ status, stderr }).toEqual({ status: 0, stderr: "" });
    };

    await install();
    const firstKey = await loadPublicationKey({ home });
    await install();
    const secondKey = await loadPublicationKey({ home });

    const wrapper = await readFile(path.join(home, ".local", "bin", "review-publication"), "utf8");
    const installedWorker = path.join(home, ".review-publication", "review-publication-worker.mjs");
    const service = await readFile(path.join(home, ".config", "systemd", "user", "review-publication@.service"), "utf8");
    const workerConfigurationPath = path.join(home, ".review-publication", "worker-config.json");
    const workerConfiguration = JSON.parse(await readFile(workerConfigurationPath, "utf8"));
    const configurationState = await stat(workerConfigurationPath);
    expect({
      keyPreserved: firstKey.equals(secondKey),
      wrapperUsesInstalledWorker: wrapper.includes(process.execPath)
        && wrapper.includes(installedWorker)
        && !wrapper.includes(repositoryRoot),
      serviceUsesInstalledWorker: service.includes(`ExecStart=\"${process.execPath}\" \"${installedWorker}\"`)
        && !service.includes(repositoryRoot)
        && !service.includes("Environment="),
      generatedServiceBudget:
        service.includes(`RuntimeMaxSec=${TOTAL_SERVICE_LIFETIME_SECONDS}s`)
        && service.includes(`TimeoutStartSec=${TOTAL_SERVICE_LIFETIME_SECONDS}s`)
        && service.includes(`TimeoutStopSec=${SERVICE_SHUTDOWN_TIMEOUT_SECONDS}s`),
      workerConfiguration,
      privateWorkerConfiguration: configurationState.mode & 0o077,
      socketManaged: (await readFile(path.join(home, ".config", "systemd", "user", "review-publication.socket"), "utf8")).includes("Managed by ai-config"),
    }).toEqual({
      keyPreserved: true,
      wrapperUsesInstalledWorker: true,
      serviceUsesInstalledWorker: true,
      generatedServiceBudget: true,
      workerConfiguration: {
        managedBy: "Managed by ai-config: review-publication",
        version: 1,
        confirmationExecutable: process.execPath,
        githubExecutable: process.execPath,
      },
      privateWorkerConfiguration: 0,
      socketManaged: true,
    });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("renders installation-owned confirmation executables for macOS and Linux", async () => {
  for (const platform of ["Darwin", "Linux"] as const) {
    const home = await mkdtemp(path.join(tmpdir(), `review-publication-confirmation-${platform}-`));
    try {
      const { status, stderr } = await runInstaller(home, platform);
      const definition = platform === "Darwin"
        ? await readFile(path.join(home, "Library", "LaunchAgents", "dev.review-publication.plist"), "utf8")
        : await readFile(path.join(home, ".config", "systemd", "user", "review-publication@.service"), "utf8");
      const installedWorker = path.join(home, ".review-publication", "review-publication-worker.mjs");
      const configuration = JSON.parse(await readFile(
        path.join(home, ".review-publication", "worker-config.json"),
        "utf8",
      ));

      expect({
        status,
        stderr,
        noCallerSelectedPlatform: !definition.includes(platform === "Darwin" ? "<string>macos</string>" : "--inetd linux"),
        noCallerSelectedConfirmation: definition.split(process.execPath).length - 1 === 1,
        installationOwnedConfirmation: configuration.confirmationExecutable,
        installationOwnedProvider: configuration.githubExecutable,
        definitionUsesInstalledWorker: definition.includes(installedWorker) && !definition.includes(repositoryRoot),
        noApprovalEnvironment: !definition.includes("APPROVAL") && !definition.includes("RESPONSE"),
      }).toEqual({
        status: 0,
        stderr: "",
        noCallerSelectedPlatform: true,
        noCallerSelectedConfirmation: true,
        installationOwnedConfirmation: process.execPath,
        installationOwnedProvider: process.execPath,
        definitionUsesInstalledWorker: true,
        noApprovalEnvironment: true,
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  }
});

test("fails installation when the platform confirmation executable is unavailable", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-no-confirmation-"));
  try {
    const missing = path.join(home, "missing-zenity");
    const { status, stderr } = await runInstaller(home, "Linux", { AI_CONFIG_CONFIRMATION_BIN: missing });

    expect({ status, clearFailure: stderr.includes("zenity is not an executable file") }).toEqual({
      status: 1,
      clearFailure: true,
    });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("refuses unsafe parents for wrapper, launchd, and systemd managed files", async () => {
  const cases = [
    { mode: "wrapper", template: "unused", relativeDestination: path.join(".local", "bin", "review-publication") },
    { mode: "worker-config", template: "unused", relativeDestination: path.join(".review-publication", "worker-config.json") },
    { mode: "launchd", template: path.join(repositoryRoot, "review-publication", "dev.review-publication.plist"), relativeDestination: path.join("Library", "LaunchAgents", "dev.review-publication.plist") },
    { mode: "systemd", template: path.join(repositoryRoot, "review-publication", "review-publication@.service"), relativeDestination: path.join(".config", "systemd", "user", "review-publication@.service") },
  ];
  for (const fixture of cases) {
    const home = await mkdtemp(path.join(tmpdir(), `review-publication-${fixture.mode}-parent-`));
    const destination = path.join(home, fixture.relativeDestination);
    try {
      await mkdir(path.dirname(destination), { recursive: true });
      await chmod(path.dirname(destination), 0o770);

      const { status, stderr } = await runRenderer(home, fixture.mode, fixture.template, destination);

      expect({ status, refused: stderr.includes("installation parent is unsafe") }).toEqual({
        status: 1,
        refused: true,
      });
      await expect(readFile(destination)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await chmod(path.dirname(destination), 0o700);
      await rm(home, { force: true, recursive: true });
    }
  }
});

test("refuses symlink traversal through a managed destination ancestor", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-parent-link-"));
  const actual = path.join(home, "actual");
  const destination = path.join(home, ".local", "bin", "review-publication");
  try {
    await mkdir(actual, { mode: 0o700 });
    await symlink(actual, path.join(home, ".local"));

    const { status, stderr } = await runRenderer(home, "wrapper", "unused", destination);

    expect({ status, refused: stderr.includes("installation parent is unsafe") }).toEqual({
      status: 1,
      refused: true,
    });
    await expect(readFile(path.join(actual, "bin", "review-publication"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("refuses an unrelated protected worker configuration", async () => {
  await expectInstallerCollision("Linux", path.join(".review-publication", "worker-config.json"));
});

test("refuses an unrelated wrapper file", async () => {
  await expectInstallerCollision("Linux", path.join(".local", "bin", "review-publication"));
});

test("refuses an unrelated macOS LaunchAgent file", async () => {
  await expectInstallerCollision("Darwin", path.join("Library", "LaunchAgents", "dev.review-publication.plist"));
});

test("refuses an unrelated systemd service file", async () => {
  await expectInstallerCollision("Linux", path.join(".config", "systemd", "user", "review-publication@.service"));
});

test("refuses an unrelated systemd socket file", async () => {
  await expectInstallerCollision("Linux", path.join(".config", "systemd", "user", "review-publication.socket"));
});

test("refuses an unrelated systemd socket link", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-socket-link-"));
  const destination = path.join(home, ".config", "systemd", "user", "review-publication.socket");
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await symlink(path.join(home, "unrelated.socket"), destination);

    const { status, stderr } = await runInstaller(home, "Linux");

    expect({ status, refused: stderr.includes("Managed service destination is unsafe") }).toEqual({
      status: 1,
      refused: true,
    });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("the explicit installation force option replaces an unrelated systemd socket link", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-socket-force-"));
  const destination = path.join(home, ".config", "systemd", "user", "review-publication.socket");
  const outside = path.join(home, "unrelated.socket");
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(outside, "unrelated state");
    await symlink(outside, destination);

    const { status, stderr } = await runInstaller(home, "Linux", { AI_CONFIG_INSTALL_FORCE: "true" });

    expect({
      status,
      stderr,
      managed: (await readFile(destination, "utf8")).includes("Managed by ai-config"),
      outside: await readFile(outside, "utf8"),
    }).toEqual({ status: 0, stderr: "", managed: true, outside: "unrelated state" });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("the explicit installation force option replaces an unrelated wrapper file", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-force-"));
  const destination = path.join(home, ".local", "bin", "review-publication");
  try {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, "unrelated state");

    const { status, stderr } = await runInstaller(home, "Linux", { AI_CONFIG_INSTALL_FORCE: "true" });

    expect({ status, stderr, replaced: (await readFile(destination, "utf8")).includes("Managed by ai-config") }).toEqual({
      status: 0,
      stderr: "",
      replaced: true,
    });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("rejects a symlinked macOS LaunchAgent without changing its target", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-launchagent-"));
  const outside = path.join(home, "outside.plist");
  try {
    const launchAgents = path.join(home, "Library", "LaunchAgents");
    await mkdir(launchAgents, { recursive: true });
    await writeFile(outside, "unrelated state");
    await symlink(outside, path.join(launchAgents, "dev.review-publication.plist"));

    const processRef = Bun.spawn(["bash", path.join(repositoryRoot, "review-publication", "install.sh")], {
      env: {
        ...process.env,
        HOME: home,
        AI_CONFIG_REPO_DIR: repositoryRoot,
        AI_CONFIG_SERVICE_ENABLE: "false",
        AI_CONFIG_SERVICE_PLATFORM: "Darwin",
        AI_CONFIG_NODE_BIN: process.execPath,
        AI_CONFIG_GH_BIN: process.execPath,
        AI_CONFIG_CONFIRMATION_BIN: process.execPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stderr] = await Promise.all([
      processRef.exited,
      new Response(processRef.stderr).text(),
    ]);

    expect({
      status,
      rejectsUnsafeDestination: stderr.includes("LaunchAgent destination is unsafe"),
      outside: await readFile(outside, "utf8"),
    }).toEqual({ status: 1, rejectsUnsafeDestination: true, outside: "unrelated state" });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

async function expectInstallerCollision(platform: "Darwin" | "Linux", relativeDestination: string) {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-collision-"));
  const destination = path.join(home, relativeDestination);
  try {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, "unrelated state");

    const { status, stderr } = await runInstaller(home, platform);

    expect({
      status,
      rejectsUnmanagedDestination: stderr.includes("destination is not managed"),
      content: await readFile(destination, "utf8"),
    }).toEqual({ status: 1, rejectsUnmanagedDestination: true, content: "unrelated state" });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
}

async function runRenderer(home: string, mode: string, template: string, destination: string) {
  const processRef = Bun.spawn([
    process.execPath,
    path.join(repositoryRoot, "review-publication", "render-installation.mjs"),
    mode,
    template,
    destination,
    process.execPath,
    path.join(repositoryRoot, "skills", "review-change", "bin", "review-publication.mjs"),
    process.execPath,
    "",
    "false",
    mode === "wrapper" ? "" : process.execPath,
  ], {
    env: { ...process.env, HOME: home },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stderr] = await Promise.all([
    processRef.exited,
    new Response(processRef.stderr).text(),
  ]);
  return { status, stderr };
}

async function runInstaller(home: string, platform: string, additionalEnvironment: Record<string, string> = {}) {
  const portCheck = path.join(home, "available-port-check");
  await writeFile(portCheck, `#!${process.execPath}\nprocess.exit(0);\n`);
  await chmod(portCheck, 0o755);
  const processRef = Bun.spawn(["bash", path.join(repositoryRoot, "review-publication", "install.sh")], {
    env: {
      ...process.env,
      HOME: home,
      AI_CONFIG_REPO_DIR: repositoryRoot,
      AI_CONFIG_SERVICE_ENABLE: "false",
      AI_CONFIG_SERVICE_PLATFORM: platform,
      AI_CONFIG_NODE_BIN: process.execPath,
      AI_CONFIG_GH_BIN: process.execPath,
      AI_CONFIG_CONFIRMATION_BIN: process.execPath,
      AI_CONFIG_PORT_CHECK_BIN: portCheck,
      ...additionalEnvironment,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stderr] = await Promise.all([
    processRef.exited,
    new Response(processRef.stderr).text(),
  ]);
  return { status, stderr };
}
