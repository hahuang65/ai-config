import { afterAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { createConcurrencyLimit } from "./concurrency-limit";
import { ISOLATED_GIT_ENV } from "./git-environment";

const REPOSITORY = path.join(import.meta.dir, "..");
const SCRIPT = path.join(REPOSITORY, "scripts", "deliver-preflight.sh");
const GIT_ENV = ISOLATED_GIT_ENV;
const temporaryDirectories: string[] = [];

const GIT_TEST_TIMEOUT_MS = 15_000;
const withGitSlot = createConcurrencyLimit(2);
const gitTest = (name: string, body: () => Promise<void>) =>
  test.concurrent(name, () => withGitSlot(body), GIT_TEST_TIMEOUT_MS);

afterAll(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

gitTest("reports a primary ordinary checkout and its dirty state", async () => {
  const repository = await createRepository();

  const clean = await preflight(repository);
  expect(clean.exitCode).toBe(0);
  expect(clean.values).toMatchObject({
    a5: "false",
    branch: "hh/test-task",
    delivery: "ordinary",
    dirty: "false",
    keep: "false",
    root: await realpath(repository),
    trunk: "main",
  });

  await writeFile(path.join(repository, "notes.txt"), "uncommitted\n");
  const dirty = await preflight(repository);
  expect(dirty.values.dirty).toBe("true");
});

gitTest("rejects linked worktrees and a trunk checked out in one", async () => {
  const repository = await createRepository();
  const linked = path.join(path.dirname(repository), "linked");
  await git(repository, ["worktree", "add", linked, "main"]);

  const linkedResult = await preflight(linked);
  expect(linkedResult.exitCode).toBe(1);
  expect(linkedResult.stderr).toContain("linked worktree");

  const primaryResult = await preflight(repository);
  expect(primaryResult.exitCode).toBe(1);
  expect(primaryResult.stderr).toContain("trunk is already checked out");
});

gitTest("accepts the primary checkout of an absorbed Git submodule", async () => {
  const root = await temporaryDirectory();
  const source = path.join(root, "source");
  const superproject = path.join(root, "superproject");
  await mkdir(source);
  await mkdir(superproject);
  await initializeRepository(source);
  await initializeRepository(superproject);
  await git(superproject, ["-c", "protocol.file.allow=always", "submodule", "add", source, "module"]);
  await git(superproject, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-am", "Add module"]);
  const module = path.join(superproject, "module");
  await git(module, ["switch", "-c", "hh/submodule-task"]);

  const result = await preflight(module);

  expect(result.exitCode).toBe(0);
  expect(result.values).toMatchObject({
    branch: "hh/submodule-task",
    delivery: "ordinary",
    primary: "absorbed-submodule",
    root: await realpath(module),
    trunk: "main",
  });
});

gitTest("trusts A5 classification only from global or system Git configuration", async () => {
  const repository = await createRepository();
  await git(repository, ["config", "ai.projectFamily", "a5"]);

  const local = await preflight(repository);
  expect(local.values).toMatchObject({ a5: "false", project_family_scope: "local" });

  const globalConfig = path.join(await temporaryDirectory(), "global.gitconfig");
  const env = { ...GIT_ENV, GIT_CONFIG_GLOBAL: globalConfig };
  await git(repository, ["config", "--unset", "ai.projectFamily"]);
  await git(repository, ["config", "--global", "ai.projectFamily", "a5"], env);
  await git(repository, ["config", "--global", "alias.pr", "!true"], env);

  const global = await preflight(repository, [], env);
  expect(global.values).toMatchObject({ a5: "true", pr_alias: "true", project_family_scope: "global" });
});

gitTest("classifies an explicit worktree intent as managed without invoking Orchard", async () => {
  const repository = await createRepository();

  const result = await preflight(repository, ["another-task", "--keep"]);

  expect(result.exitCode).toBe(0);
  expect(result.values).toMatchObject({ delivery: "managed", keep: "true", reason: "explicit-intent" });
});

gitTest("classifies a checkout beneath the canonical Orchard root as managed", async () => {
  const home = await temporaryDirectory();
  const repository = path.join(home, ".orchard", "project", "task");
  await mkdir(repository, { recursive: true });
  await initializeRepository(repository);
  const env = { ...GIT_ENV, HOME: home };

  const result = await preflight(repository, [], env);

  expect(result.exitCode).toBe(0);
  expect(result.values).toMatchObject({ delivery: "managed", keep: "false", reason: "orchard-root" });
});

gitTest("rejects ambiguous fallback trunk branches", async () => {
  const repository = await createRepository();
  await git(repository, ["symbolic-ref", "--delete", "refs/remotes/origin/HEAD"]);
  await git(repository, ["branch", "master", "main"]);

  const result = await preflight(repository);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("trunk is ambiguous");
});

gitTest("rejects detached HEAD and unsupported ordinary options", async () => {
  const repository = await createRepository();
  await git(repository, ["switch", "--detach"]);

  const detached = await preflight(repository);
  expect(detached.exitCode).toBe(1);
  expect(detached.stderr).toContain("named feature branch");

  await git(repository, ["switch", "hh/test-task"]);
  const unsupported = await preflight(repository, ["--unknown"]);
  expect(unsupported.exitCode).toBe(1);
  expect(unsupported.stderr).toContain("unsupported option");
});

async function createRepository() {
  const root = await temporaryDirectory();
  const repository = path.join(root, "repository");
  await mkdir(repository);
  await initializeRepository(repository);
  await git(repository, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await git(repository, ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
  await git(repository, ["switch", "-c", "hh/test-task"]);
  return repository;
}

async function initializeRepository(repository: string) {
  await git(repository, ["init", "-b", "main"]);
  await git(repository, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "Initial"]);
}

async function preflight(cwd: string, args: string[] = [], env = GIT_ENV) {
  const result = await run(["bash", SCRIPT, ...args], cwd, env);
  const values = Object.fromEntries(
    result.stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("=");
        return [line.slice(0, separator), line.slice(separator + 1)];
      }),
  );
  return { ...result, values };
}

async function git(cwd: string, args: string[], env = GIT_ENV) {
  const result = await run(["git", ...args], cwd, env);
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result;
}

async function run(command: string[], cwd: string, env: Record<string, string | undefined>) {
  const child = Bun.spawn(command, {
    cwd,
    env,
    signal: AbortSignal.timeout(10_000),
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stderr, stdout };
}

async function temporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "deliver-preflight-"));
  temporaryDirectories.push(directory);
  return directory;
}
