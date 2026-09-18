import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateGitHubCliPath } from "../../skills/review-change/runtime/review-publication-executable.mjs";
import { isolatedInstallerEnvironment } from "../review-publication-install-fixture";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

describe("Review publication executable trust", () => {
  test("accepts the exact Homebrew gh link through current-user group-writable ancestors", async () => {
    const fixture = await homebrewGitHubCli();
    await chmod(fixture.prefix, 0o775);

    expect(validateGitHubCliPath(fixture.link)).toBe(fixture.link);
  });

  test("rejects a Homebrew-bin link outside the exact gh Cellar ancestry", async () => {
    const fixture = await homebrewGitHubCli({ target: "../other/gh" });
    await mkdir(path.join(fixture.prefix, "other"), { recursive: true });
    await writeExecutable(path.join(fixture.prefix, "other", "gh"));

    expect(() => validateGitHubCliPath(fixture.link)).toThrow("unsafe");
  });

  test("validates and preserves the exact Homebrew gh link during installation", async () => {
    const home = await mkdtemp(path.join(tmpdir(), "review-publication-homebrew-install-"));
    temporaryRoots.push(home);
    const fixture = await homebrewGitHubCli({ root: home });
    await chmod(fixture.prefix, 0o775);

    const installed = await runInstaller(home, fixture.link);
    const wrapper = await readFile(path.join(home, ".local", "bin", "review-publication"), "utf8");
    await rm(fixture.link);
    await symlink("../Cellar/not-gh/2.70.0/bin/gh", fixture.link);
    await writeExecutable(path.join(fixture.prefix, "Cellar", "not-gh", "2.70.0", "bin", "gh"));
    const rejected = await runInstaller(home, fixture.link);

    expect({
      installed: installed.status,
      preservedLink: wrapper.includes(fixture.link),
      rejected: rejected.status,
      unsafe: rejected.stderr.includes("unsafe"),
    }).toEqual({ installed: 0, preservedLink: true, rejected: 1, unsafe: true });
  });

  test("rejects foreign-owned group-writable and non-sticky world-writable ancestors", async () => {
    const foreign = await directGitHubCli();
    await chmod(foreign.parent, 0o770);
    const currentUserId = typeof process.getuid === "function" ? process.getuid() : 0;
    expect(() => validateGitHubCliPath(foreign.executable, { userId: currentUserId + 1 })).toThrow("unsafe");

    await chmod(foreign.parent, 0o777);
    expect(() => validateGitHubCliPath(foreign.executable)).toThrow("unsafe");
  });
});

async function homebrewGitHubCli({
  target = "../Cellar/gh/2.70.0/bin/gh",
  root: requestedRoot,
}: { target?: string; root?: string } = {}) {
  const root = requestedRoot ?? await mkdtemp(path.join(tmpdir(), "review-gh-homebrew-"));
  if (!requestedRoot) temporaryRoots.push(root);
  const prefix = path.join(root, "homebrew");
  const executable = path.join(prefix, "Cellar", "gh", "2.70.0", "bin", "gh");
  const link = path.join(prefix, "bin", "gh");
  await mkdir(path.dirname(link), { recursive: true });
  await writeExecutable(executable);
  await symlink(target, link);
  return { executable, link, prefix };
}

async function directGitHubCli() {
  const root = await mkdtemp(path.join(tmpdir(), "review-gh-direct-"));
  temporaryRoots.push(root);
  const parent = path.join(root, "bin");
  const executable = path.join(parent, "gh");
  await writeExecutable(executable);
  return { executable, parent };
}

async function writeExecutable(destination: string) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, "#!/bin/sh\nexit 0\n");
  await chmod(destination, 0o755);
}

async function runInstaller(home: string, ghExecutable: string) {
  const environment = await isolatedInstallerEnvironment({
    home,
    repositoryRoot,
    platform: "Linux",
    githubExecutable: ghExecutable,
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
