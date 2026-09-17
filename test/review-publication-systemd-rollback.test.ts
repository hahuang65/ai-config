import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));

test("a first enablement-before-start failure removes introduced systemd state", async () => {
  const fixture = await systemdFixture();
  try {
    const installation = await fixture.install({ AI_CONFIG_FAIL_AFTER_ENABLE: "true" });

    expect({
      status: installation.status,
      activationFailure: installation.stderr.includes("fixture start failed after enablement"),
      state: await fixture.state(),
      managedFiles: await fixture.managedFilesExist(),
      events: await fixture.events(),
    }).toEqual({
      status: 1,
      activationFailure: true,
      state: { loaded: "not-found", enabled: "disabled", active: "inactive" },
      managedFiles: false,
      events: expect.arrayContaining(["enable-before-start-failed", "disable", "daemon-reload"]),
    });
  } finally {
    await fixture.cleanup();
  }
});

test("rollback reports a systemd restoration failure without hiding the activation failure", async () => {
  const fixture = await systemdFixture();
  try {
    const installation = await fixture.install({
      AI_CONFIG_FAIL_AFTER_ENABLE: "true",
      AI_CONFIG_FAIL_ROLLBACK_DISABLE: "true",
    });

    expect({
      status: installation.status,
      activationFailure: installation.stderr.includes("fixture start failed after enablement"),
      rollbackFailure: installation.stderr.includes("Review publication rollback failed while restoring systemd enablement."),
    }).toEqual({ status: 1, activationFailure: true, rollbackFailure: true });
  } finally {
    await fixture.cleanup();
  }
});

test("a failed upgrade restores an exact prior loaded disabled inactive systemd installation", async () => {
  const fixture = await systemdFixture();
  try {
    expect(await fixture.install({ AI_CONFIG_SERVICE_ENABLE: "false" })).toEqual({ status: 0, stderr: "" });
    const beforeFiles = await fixture.managedSnapshot();
    const beforeState = await fixture.state();
    const eventOffset = (await fixture.events()).length;

    const installation = await fixture.install({
      AI_CONFIG_FAIL_AFTER_ENABLE: "true",
      AI_CONFIG_GH_BIN: "/usr/bin/true",
    });

    expect({
      status: installation.status,
      files: await fixture.managedSnapshot(),
      beforeState,
      state: await fixture.state(),
      rollbackEvents: (await fixture.events()).slice(eventOffset),
    }).toEqual({
      status: 1,
      files: beforeFiles,
      beforeState: { loaded: "loaded", enabled: "disabled", active: "inactive" },
      state: { loaded: "loaded", enabled: "disabled", active: "inactive" },
      rollbackEvents: expect.arrayContaining(["enable-before-start-failed", "disable", "daemon-reload"]),
    });
  } finally {
    await fixture.cleanup();
  }
});

async function systemdFixture() {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-systemd-rollback-"));
  const stateDirectory = path.join(home, "fixture-state");
  const eventsPath = path.join(stateDirectory, "events");
  const enabledPath = path.join(stateDirectory, "enabled");
  const activePath = path.join(stateDirectory, "active");
  const rollbackPath = path.join(stateDirectory, "rollback");
  const socketPath = path.join(home, ".config", "systemd", "user", "review-publication.socket");
  await mkdir(stateDirectory);
  await writeFile(path.join(stateDirectory, ".keep"), "");
  const manager = path.join(home, "systemctl-fixture");
  const portCheck = path.join(home, "port-check-fixture");
  await writeFile(manager, systemctlProgram({ activePath, enabledPath, eventsPath, rollbackPath, socketPath }));
  await writeFile(portCheck, `#!${process.execPath}\nconst fs=require("node:fs");process.exit(fs.existsSync(${JSON.stringify(activePath)})?10:0);\n`);
  await Promise.all([chmod(manager, 0o700), chmod(portCheck, 0o700)]);

  const install = async (environment: Record<string, string> = {}) => {
    const processRef = Bun.spawn(["bash", path.join(repositoryRoot, "review-publication", "install.sh")], {
      env: {
        ...process.env,
        HOME: home,
        AI_CONFIG_REPO_DIR: repositoryRoot,
        AI_CONFIG_SERVICE_ENABLE: "true",
        AI_CONFIG_SERVICE_PLATFORM: "Linux",
        AI_CONFIG_NODE_BIN: process.execPath,
        AI_CONFIG_GH_BIN: process.execPath,
        AI_CONFIG_CONFIRMATION_BIN: process.execPath,
        AI_CONFIG_PORT_CHECK_BIN: portCheck,
        AI_CONFIG_SYSTEMCTL_BIN: manager,
        ...environment,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stderr] = await Promise.all([processRef.exited, new Response(processRef.stderr).text()]);
    return { status, stderr };
  };

  return {
    cleanup: () => rm(home, { force: true, recursive: true }),
    events: async () => {
      try { return (await readFile(eventsPath, "utf8")).trim().split("\n").filter(Boolean); } catch { return []; }
    },
    install,
    managedFilesExist: async () => {
      try { await stat(socketPath); return true; } catch { return false; }
    },
    managedSnapshot: () => managedSnapshot(home),
    state: async () => ({
      loaded: await exists(socketPath) ? "loaded" : "not-found",
      enabled: await exists(enabledPath) ? "enabled" : "disabled",
      active: await exists(activePath) ? "active" : "inactive",
    }),
  };
}

function systemctlProgram(paths: Record<string, string>) {
  return `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const event = (name) => fs.appendFileSync(${JSON.stringify(paths.eventsPath)}, name + "\\n");
const exists = (target) => fs.existsSync(target);
if (args.includes("is-enabled")) {
  console.log(exists(${JSON.stringify(paths.enabledPath)}) ? "enabled" : "disabled");
  process.exit(exists(${JSON.stringify(paths.enabledPath)}) ? 0 : 1);
}
if (args.includes("is-active")) {
  console.log(exists(${JSON.stringify(paths.activePath)}) ? "active" : "inactive");
  process.exit(exists(${JSON.stringify(paths.activePath)}) ? 0 : 3);
}
if (args.includes("show")) {
  const loaded = exists(${JSON.stringify(paths.socketPath)}) ? "loaded" : "not-found";
  if (args.includes("--value")) console.log(loaded);
  else console.log("Id=review-publication.socket\\nLoadState=" + loaded + "\\nActiveState=" + (exists(${JSON.stringify(paths.activePath)}) ? "active" : "inactive") + "\\nSubState=" + (exists(${JSON.stringify(paths.activePath)}) ? "listening" : "dead") + "\\nFragmentPath=" + ${JSON.stringify(paths.socketPath)} + "\\nListen=127.0.0.1:4392 (Stream)");
  process.exit(loaded === "loaded" ? 0 : 1);
}
if (args.includes("daemon-reload")) { event("daemon-reload"); process.exit(0); }
if (args.includes("disable")) {
  if (process.env.AI_CONFIG_FAIL_ROLLBACK_DISABLE === "true" && exists(${JSON.stringify(paths.rollbackPath)})) {
    console.error("fixture rollback disable failed"); process.exit(1);
  }
  fs.rmSync(${JSON.stringify(paths.enabledPath)}, { force: true }); event("disable"); process.exit(0);
}
if (args.includes("enable")) {
  fs.writeFileSync(${JSON.stringify(paths.enabledPath)}, "enabled");
  if (process.env.AI_CONFIG_FAIL_AFTER_ENABLE === "true" && !exists(${JSON.stringify(paths.rollbackPath)})) {
    fs.writeFileSync(${JSON.stringify(paths.rollbackPath)}, "rollback"); event("enable-before-start-failed");
    console.error("fixture start failed after enablement"); process.exit(1);
  }
  event("enable");
  if (args.includes("--now")) fs.writeFileSync(${JSON.stringify(paths.activePath)}, "active");
  process.exit(0);
}
if (args.includes("start")) { fs.writeFileSync(${JSON.stringify(paths.activePath)}, "active"); event("start"); process.exit(0); }
if (args.includes("stop")) { fs.rmSync(${JSON.stringify(paths.activePath)}, { force: true }); event("stop"); process.exit(0); }
process.exit(0);
`;
}

async function managedSnapshot(home: string) {
  const relativePaths = [
    path.join(".review-publication", "review-publication-worker.mjs"),
    path.join(".review-publication", "worker-config.json"),
    path.join(".local", "bin", "review-publication"),
    path.join(".config", "systemd", "user", "review-publication.socket"),
    path.join(".config", "systemd", "user", "review-publication@.service"),
  ];
  return Object.fromEntries(await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    (await readFile(path.join(home, relativePath))).toString("base64"),
  ])));
}

async function exists(target: string) {
  try { await stat(target); return true; } catch { return false; }
}
