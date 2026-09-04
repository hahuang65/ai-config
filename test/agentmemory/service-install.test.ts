import { afterEach, describe, expect, test } from "bun:test";
import { chmod, cp, lstat, mkdtemp, mkdir, readFile, readlink, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const installer = path.join(repositoryRoot, "agentmemory", "install.sh");
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agentmemory-service-install-"));
  temporaryRoots.push(root);
  const binDirectory = path.join(root, "bin");
  const logDirectory = path.join(root, "calls");
  await Promise.all([mkdir(binDirectory), mkdir(logDirectory)]);

  const fakeAgentmemory = path.join(binDirectory, "agentmemory");
  const fakeMise = path.join(binDirectory, "mise");
  const fakeLaunchctl = path.join(binDirectory, "launchctl");
  const fakeSystemctl = path.join(binDirectory, "systemctl");
  await writeFile(fakeAgentmemory, "#!/bin/sh\nexit 0\n");
  await writeFile(fakeMise, `#!/bin/sh
set -eu
case "$1" in
  install)
    touch "$AI_CONFIG_SERVICE_TEST_LOG/mise-install"
    touch "$AI_CONFIG_SERVICE_TEST_LOG/mise-installed"
    ;;
  reshim)
    touch "$AI_CONFIG_SERVICE_TEST_LOG/mise-reshim"
    mkdir -p "$HOME/.local/share/mise/shims"
    cp "$AI_CONFIG_FAKE_AGENTMEMORY" "$HOME/.local/share/mise/shims/agentmemory"
    ;;
  which)
    touch "$AI_CONFIG_SERVICE_TEST_LOG/mise-which"
    [ -f "$AI_CONFIG_SERVICE_TEST_LOG/mise-installed" ] || exit 1
    printf '%s\\n' "$AI_CONFIG_FAKE_AGENTMEMORY"
    ;;
esac
`);
  await writeFile(fakeLaunchctl, `#!/bin/sh
set -eu
case "$1" in
  print)
    [ -f "$AI_CONFIG_SERVICE_TEST_LOG/launchctl-active" ]
    ;;
  bootout)
    rm -f "$AI_CONFIG_SERVICE_TEST_LOG/launchctl-active"
    touch "$AI_CONFIG_SERVICE_TEST_LOG/launchctl-bootout"
    ;;
  bootstrap)
    touch "$AI_CONFIG_SERVICE_TEST_LOG/launchctl-active"
    touch "$AI_CONFIG_SERVICE_TEST_LOG/launchctl-bootstrap"
    ;;
  *)
    touch "$AI_CONFIG_SERVICE_TEST_LOG/launchctl-$1"
    ;;
esac
`);
  await writeFile(fakeSystemctl, `#!/bin/sh\nset -eu\nshift\ntouch "$AI_CONFIG_SERVICE_TEST_LOG/systemctl-$1"\n`);
  await Promise.all([
    chmod(fakeAgentmemory, 0o755),
    chmod(fakeMise, 0o755),
    chmod(fakeLaunchctl, 0o755),
    chmod(fakeSystemctl, 0o755),
  ]);

  return { fakeAgentmemory, fakeLaunchctl, fakeMise, fakeSystemctl, logDirectory, root };
}

async function installService(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  platform: "Darwin" | "Linux" = "Darwin",
  force = false,
) {
  const subprocess = Bun.spawn(["bash", installer], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      AI_CONFIG_FAKE_AGENTMEMORY: fixture.fakeAgentmemory,
      AI_CONFIG_INSTALL_FORCE: String(force),
      AI_CONFIG_LAUNCHCTL_BIN: fixture.fakeLaunchctl,
      AI_CONFIG_MISE_BIN: fixture.fakeMise,
      AI_CONFIG_REPO_DIR: repositoryRoot,
      AI_CONFIG_SERVICE_DOMAIN: "gui/999",
      AI_CONFIG_SERVICE_ENABLE: "true",
      AI_CONFIG_SERVICE_PLATFORM: platform,
      AI_CONFIG_SERVICE_TEST_LOG: fixture.logDirectory,
      AI_CONFIG_SYSTEMCTL_BIN: fixture.fakeSystemctl,
      HOME: fixture.root,
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    subprocess.exited,
    new Response(subprocess.stderr).text(),
  ]);
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
}

describe("agentmemory service installation", () => {
  test("links configuration and installs and enables the LaunchAgent", async () => {
    const fixture = await createFixture();
    await installService(fixture);

    expect(await readlink(path.join(fixture.root, ".agentmemory", "iii-config.yaml"))).toBe(
      path.join(repositoryRoot, "agentmemory", "iii-config.yaml"),
    );
    expect(await readlink(path.join(fixture.root, ".local", "bin", "agentmemory"))).toBe(
      fixture.fakeAgentmemory,
    );
    const installedPlist = path.join(fixture.root, "Library", "LaunchAgents", "dev.agentmemory.plist");
    expect(await readFile(installedPlist, "utf8")).toBe(
      await readFile(path.join(repositoryRoot, "agentmemory", "dev.agentmemory.plist"), "utf8"),
    );
    expect((await lstat(installedPlist)).isSymbolicLink()).toBe(false);
    expect((await Promise.all([
      "mise-install",
      "mise-reshim",
      "mise-which",
      "launchctl-bootstrap",
      "launchctl-enable",
      "launchctl-kickstart",
    ].map(async (name) => readFile(path.join(fixture.logDirectory, name), "utf8"))))).toEqual(["", "", "", "", "", ""]);
  });

  test("skips mise installation when the exact runtime and shim already exist", async () => {
    const fixture = await createFixture();
    const shim = path.join(fixture.root, ".local", "share", "mise", "shims", "agentmemory");
    await mkdir(path.dirname(shim), { recursive: true });
    await Promise.all([
      writeFile(path.join(fixture.logDirectory, "mise-installed"), ""),
      writeFile(shim, "#!/bin/sh\nexit 0\n"),
    ]);
    await chmod(shim, 0o755);

    await installService(fixture);

    expect(await Bun.file(path.join(fixture.logDirectory, "mise-install")).exists()).toBe(false);
    expect(await Bun.file(path.join(fixture.logDirectory, "mise-reshim")).exists()).toBe(false);
    expect(await Bun.file(path.join(fixture.logDirectory, "mise-which")).exists()).toBe(true);
  });

  test("does not restart an unchanged healthy service", async () => {
    const fixture = await createFixture();
    await installService(fixture);
    const mutationMarkers = [
      "launchctl-bootstrap",
      "launchctl-enable",
      "launchctl-kickstart",
      "mise-install",
      "mise-reshim",
    ].map((name) => path.join(fixture.logDirectory, name));
    await Promise.all(mutationMarkers.map((marker) => rm(marker, { force: true })));

    await installService(fixture);

    expect(await Promise.all(mutationMarkers.map((marker) => Bun.file(marker).exists()))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("uses the mise shim and persistent data paths in the macOS service", async () => {
    const plist = await readFile(path.join(repositoryRoot, "agentmemory", "dev.agentmemory.plist"), "utf8");
    expect(plist).toContain("/Users/hhhuang/.local/share/mise/shims/agentmemory");
    expect(plist).toContain("/Users/hhhuang/.dotfiles/ai");
    expect(plist).toContain("/Users/hhhuang/data");
  });

  test("installs and enables the systemd user unit on Linux", async () => {
    const fixture = await createFixture();
    await installService(fixture, "Linux");

    expect(await readlink(path.join(fixture.root, ".config", "systemd", "user", "agentmemory.service"))).toBe(
      path.join(repositoryRoot, "agentmemory", "agentmemory.service"),
    );
    expect((await Promise.all([
      "systemctl-daemon-reload",
      "systemctl-enable",
      "systemctl-restart",
    ].map(async (name) => readFile(path.join(fixture.logDirectory, name), "utf8"))))).toEqual(["", "", ""]);
    expect(await readFile(path.join(fixture.logDirectory, "mise-install"), "utf8")).toBe("");
  });

  test("does not restart an unchanged healthy systemd service", async () => {
    const fixture = await createFixture();
    await installService(fixture, "Linux");
    const mutationMarkers = [
      "systemctl-daemon-reload",
      "systemctl-enable",
      "systemctl-restart",
      "mise-install",
      "mise-reshim",
    ].map((name) => path.join(fixture.logDirectory, name));
    await Promise.all(mutationMarkers.map((marker) => rm(marker, { force: true })));

    await installService(fixture, "Linux");

    expect(await Promise.all(mutationMarkers.map((marker) => Bun.file(marker).exists()))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("uses portable home paths in the Linux service", async () => {
    const unit = await readFile(path.join(repositoryRoot, "agentmemory", "agentmemory.service"), "utf8");
    expect(unit).toContain("WorkingDirectory=%h/.dotfiles/ai");
    expect(unit).toContain("ExecStart=%h/.local/share/mise/shims/agentmemory --data-dir %h/data");
    expect(unit).toContain("WantedBy=default.target");
  });

  test("migrates matching regular files to canonical links", async () => {
    const fixture = await createFixture();
    const configurationDirectory = path.join(fixture.root, ".agentmemory");
    const launchAgentsDirectory = path.join(fixture.root, "Library", "LaunchAgents");
    await Promise.all([mkdir(configurationDirectory), mkdir(launchAgentsDirectory, { recursive: true })]);
    await Promise.all([
      cp(path.join(repositoryRoot, "agentmemory", "iii-config.yaml"), path.join(configurationDirectory, "iii-config.yaml")),
      cp(path.join(repositoryRoot, "agentmemory", "dev.agentmemory.plist"), path.join(launchAgentsDirectory, "dev.agentmemory.plist")),
    ]);

    await installService(fixture);

    expect(await readlink(path.join(configurationDirectory, "iii-config.yaml"))).toBe(
      path.join(repositoryRoot, "agentmemory", "iii-config.yaml"),
    );
    expect(await readFile(path.join(launchAgentsDirectory, "dev.agentmemory.plist"), "utf8")).toBe(
      await readFile(path.join(repositoryRoot, "agentmemory", "dev.agentmemory.plist"), "utf8"),
    );
  });

  test("preserves conflicting user-owned configuration", async () => {
    const fixture = await createFixture();
    const target = path.join(fixture.root, ".agentmemory", "iii-config.yaml");
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, "user-owned\n");

    await installService(fixture, "Darwin");

    expect(await readFile(target, "utf8")).toBe("user-owned\n");
  });
});
