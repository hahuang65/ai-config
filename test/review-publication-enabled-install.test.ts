import { expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const platforms = ["Darwin", "Linux"] as const;

test("enabled repeat installation accepts only the exact managed listener on macOS and Linux", async () => {
  for (const platform of platforms) {
    const fixture = await serviceFixture(platform);
    try {
      expect(await fixture.install()).toMatchObject({ status: 0 });
      const eventOffset = (await fixture.events()).length;

      expect(await fixture.install()).toEqual({ status: 0, stderr: "" });
      const repeatEvents = (await fixture.events()).slice(eventOffset);

      expect({
        platform,
        ownerChecked: repeatEvents.some((event) => event === (platform === "Darwin" ? "print" : "show")),
        quiesced: repeatEvents.some((event) => event === (platform === "Darwin" ? "bootout" : "stop-socket")),
        reloaded: repeatEvents.some((event) => event === (platform === "Darwin" ? "bootstrap" : "daemon-reload")),
        listening: await fixture.isListening(),
      }).toEqual({ platform, ownerChecked: true, quiesced: true, reloaded: true, listening: true });
    } finally {
      await fixture.cleanup();
    }
  }
}, 15_000);

test("enabled repeat installation rejects unrelated and ambiguous listener ownership", async () => {
  for (const platform of platforms) {
    for (const owner of ["unrelated", "ambiguous"] as const) {
      const fixture = await serviceFixture(platform);
      try {
        expect(await fixture.install()).toMatchObject({ status: 0 });
        const before = await fixture.snapshot();
        const installation = await fixture.install({ AI_CONFIG_FIXTURE_OWNER: owner });

        expect({
          platform,
          owner,
          status: installation.status,
          corrective: installation.stderr.includes("cannot verify that 127.0.0.1:4392 belongs to the managed"),
          preserved: await fixture.snapshot(),
          listening: await fixture.isListening(),
        }).toEqual({ platform, owner, status: 1, corrective: true, preserved: before, listening: true });
      } finally {
        await fixture.cleanup();
      }
    }
  }
}, 15_000);

test("enabled repeat installation rejects a managed service with the wrong installed socket definition", async () => {
  for (const platform of platforms) {
    const fixture = await serviceFixture(platform);
    try {
      expect(await fixture.install()).toMatchObject({ status: 0 });
      await fixture.changeInstalledPort(4393);
      const before = await fixture.snapshot();

      const installation = await fixture.install();

      expect({
        platform,
        status: installation.status,
        corrective: installation.stderr.includes("cannot verify that 127.0.0.1:4392 belongs to the managed"),
        preserved: await fixture.snapshot(),
      }).toEqual({ platform, status: 1, corrective: true, preserved: before });
    } finally {
      await fixture.cleanup();
    }
  }
}, 15_000);

test("failed enabled upgrades restore the previous valid installation and listener", async () => {
  for (const platform of platforms) {
    const fixture = await serviceFixture(platform);
    try {
      expect(await fixture.install()).toMatchObject({ status: 0 });
      const before = await fixture.snapshot();
      const eventOffset = (await fixture.events()).length;

      const installation = await fixture.install({
        AI_CONFIG_FAIL_ACTIVATION: "true",
        AI_CONFIG_GH_BIN: "/usr/bin/true",
      });
      const upgradeEvents = (await fixture.events()).slice(eventOffset);

      expect({
        platform,
        status: installation.status,
        activationFailed: installation.stderr.includes("fixture activation failed"),
        preserved: await fixture.snapshot(),
        quiesceBeforeActivation: upgradeEvents.indexOf(platform === "Darwin" ? "bootout" : "stop-socket")
          < upgradeEvents.indexOf(platform === "Darwin" ? "bootstrap-failed" : "enable-failed"),
        restoredListener: await fixture.isListening(),
      }).toEqual({
        platform,
        status: 1,
        activationFailed: true,
        preserved: before,
        quiesceBeforeActivation: true,
        restoredListener: true,
      });
    } finally {
      await fixture.cleanup();
    }
  }
}, 15_000);

async function serviceFixture(platform: typeof platforms[number]) {
  const home = await mkdtemp(path.join(tmpdir(), `review-publication-enabled-${platform}-`));
  const listener = path.join(home, "listener-active");
  const eventsPath = path.join(home, "service-events.jsonl");
  const portCheck = await executable(home, "port-check", `
const { existsSync } = require("node:fs");
process.exit(existsSync(${JSON.stringify(listener)}) ? 10 : 0);
`);
  const manager = await executable(home, "service-manager", serviceManagerProgram(platform, home, listener, eventsPath));
  const install = async (additionalEnvironment: Record<string, string> = {}) => {
    const processRef = Bun.spawn(["bash", path.join(repositoryRoot, "review-publication", "install.sh")], {
      env: {
        ...process.env,
        HOME: home,
        AI_CONFIG_REPO_DIR: repositoryRoot,
        AI_CONFIG_SERVICE_ENABLE: "true",
        AI_CONFIG_SERVICE_PLATFORM: platform,
        AI_CONFIG_NODE_BIN: process.execPath,
        AI_CONFIG_GH_BIN: process.execPath,
        AI_CONFIG_CONFIRMATION_BIN: process.execPath,
        AI_CONFIG_PORT_CHECK_BIN: portCheck,
        ...(platform === "Darwin" ? { AI_CONFIG_LAUNCHCTL_BIN: manager } : { AI_CONFIG_SYSTEMCTL_BIN: manager }),
        ...additionalEnvironment,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stderr] = await Promise.all([processRef.exited, new Response(processRef.stderr).text()]);
    return { status, stderr };
  };
  return {
    cleanup: () => rm(home, { force: true, recursive: true }),
    changeInstalledPort: async (port: number) => {
      const definition = platform === "Darwin"
        ? path.join(home, "Library", "LaunchAgents", "dev.review-publication.plist")
        : path.join(home, ".config", "systemd", "user", "review-publication.socket");
      const content = await readFile(definition, "utf8");
      await writeFile(definition, content.replace("4392", String(port)));
    },
    events: async () => {
      try {
        return (await readFile(eventsPath, "utf8")).trim().split("\n").filter(Boolean);
      } catch (error: any) {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    },
    install,
    isListening: async () => {
      try { await readFile(listener); return true; } catch { return false; }
    },
    snapshot: () => installationSnapshot(home, platform),
  };
}

function serviceManagerProgram(platform: typeof platforms[number], home: string, listener: string, events: string) {
  const definition = platform === "Darwin"
    ? path.join(home, "Library", "LaunchAgents", "dev.review-publication.plist")
    : path.join(home, ".config", "systemd", "user", "review-publication.socket");
  return `
const fs = require("node:fs");
const args = process.argv.slice(2);
const owner = process.env.AI_CONFIG_FIXTURE_OWNER || "exact";
const event = (name) => fs.appendFileSync(${JSON.stringify(events)}, name + "\\n");
const activate = (successEvent, failedEvent) => {
  const changed = fs.readFileSync(${JSON.stringify(path.join(home, ".review-publication", "worker-config.json"))}, "utf8").includes("/usr/bin/true");
  const failedOnce = ${JSON.stringify(path.join(home, "activation-failed-once"))};
  if (process.env.AI_CONFIG_FAIL_ACTIVATION === "true" && changed && !fs.existsSync(failedOnce)) {
    fs.writeFileSync(failedOnce, "1"); event(failedEvent); console.error("fixture activation failed"); process.exit(1);
  }
  fs.writeFileSync(${JSON.stringify(listener)}, "active"); event(successEvent);
};
if (${JSON.stringify(platform)} === "Darwin") {
  if (args[0] === "print") {
    event("print");
    if (owner === "unrelated") process.exit(113);
    const socket = owner === "exact" ? 'sockets = { "Listener" = { service name = 4392 } }' : "sockets = unknown";
    console.log(args[1] + " = {\\n path = " + ${JSON.stringify(definition)} + "\\n state = waiting\\n " + socket + "\\n}");
  } else if (args[0] === "bootout") { fs.rmSync(${JSON.stringify(listener)}, { force: true }); event("bootout"); }
  else if (args[0] === "bootstrap") activate("bootstrap", "bootstrap-failed");
  else if (args[0] === "enable") event("enable");
} else {
  const command = args.find((argument) => ["show", "stop", "daemon-reload", "enable", "start"].includes(argument));
  if (command === "show") {
    event("show");
    if (owner === "unrelated") { console.log("Id=unrelated.socket"); process.exit(0); }
    console.log(["Id=review-publication.socket", "LoadState=loaded", "ActiveState=active", "SubState=listening", "FragmentPath=" + ${JSON.stringify(definition)}, owner === "exact" ? "Listen=127.0.0.1:4392 (Stream)" : "Listen="].join("\\n"));
  } else if (command === "stop") {
    if (args.some((argument) => argument === "review-publication.socket")) { fs.rmSync(${JSON.stringify(listener)}, { force: true }); event("stop-socket"); }
    else event("stop-workers");
  } else if (command === "daemon-reload") event("daemon-reload");
  else if (command === "enable") activate("enable", "enable-failed");
  else if (command === "start") activate("start", "start-failed");
}
`;
}

async function executable(home: string, name: string, source: string) {
  const target = path.join(home, name);
  await writeFile(target, `#!${process.execPath}\n${source}\n`);
  await chmod(target, 0o700);
  return target;
}

async function installationSnapshot(home: string, platform: typeof platforms[number]) {
  const relativePaths = [
    path.join(".review-publication", "review-publication-worker.mjs"),
    path.join(".review-publication", "worker-config.json"),
    path.join(".local", "bin", "review-publication"),
    ...(platform === "Darwin"
      ? [path.join("Library", "LaunchAgents", "dev.review-publication.plist")]
      : [
          path.join(".config", "systemd", "user", "review-publication.socket"),
          path.join(".config", "systemd", "user", "review-publication@.service"),
        ]),
  ];
  return Object.fromEntries(await Promise.all(relativePaths.map(async (relativePath) => [
    relativePath,
    (await readFile(path.join(home, relativePath))).toString("base64"),
  ])));
}
