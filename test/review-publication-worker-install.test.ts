import { expect, test } from "bun:test";
import { chmod, cp, mkdtemp, mkdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isolatedInstallerEnvironment } from "./review-publication-install-fixture";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const installedWorkerRelativePath = path.join(".review-publication", "review-publication-worker.mjs");
const nodeExecutable = Bun.which("node");
if (!nodeExecutable) throw new Error("node is required for the publication worker installation test");

test("unsupported service platforms fail with a corrective error", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-unsupported-"));
  try {
    const processRef = Bun.spawn(["bash", path.join(repositoryRoot, "review-publication", "install.sh")], {
      env: {
        ...process.env,
        HOME: home,
        AI_CONFIG_REPO_DIR: repositoryRoot,
        AI_CONFIG_SERVICE_ENABLE: "true",
        AI_CONFIG_SERVICE_PLATFORM: "Plan9",
        AI_CONFIG_NODE_BIN: nodeExecutable,
        AI_CONFIG_GH_BIN: process.execPath,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [status, stderr] = await Promise.all([
      processRef.exited,
      new Response(processRef.stderr).text(),
    ]);

    expect({ status, corrective: stderr.includes("requires macOS launchd or Linux systemd") }).toEqual({
      status: 1,
      corrective: true,
    });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
});

test("installed publication worker remains independent of edited or deleted repository source", async () => {
  const fixtureRoot = await createRepositoryFixture();
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-worker-source-"));
  try {
    expect(await runInstaller(home, fixtureRoot)).toEqual({ status: 0, stderr: "" });
    const installedWorker = path.join(home, installedWorkerRelativePath);
    const originalArtifact = await readFile(installedWorker, "utf8");
    const sourceWorker = path.join(fixtureRoot, "skills", "review-change", "bin", "review-publication.mjs");
    const wrapper = path.join(home, ".local", "bin", "review-publication");

    await writeFile(sourceWorker, "throw new Error('edited repository source');\n");
    expect(await runWorkerValidation(wrapper)).toEqual({ status: 0, stdout: `${process.execPath}\n`, stderr: "" });
    await unlink(sourceWorker);
    expect(await runWorkerValidation(wrapper)).toEqual({ status: 0, stdout: `${process.execPath}\n`, stderr: "" });
    expect(await readFile(installedWorker, "utf8")).toBe(originalArtifact);
  } finally {
    await rm(home, { force: true, recursive: true });
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

test("installation rejects a publication worker artifact that fails its committed integrity check", async () => {
  const fixtureRoot = await createRepositoryFixture();
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-worker-integrity-"));
  try {
    await writeFile(
      path.join(fixtureRoot, "review-publication", "review-publication-worker.bundle.mjs"),
      "console.error('corrupt worker artifact');\n",
    );

    const installation = await runInstaller(home, fixtureRoot);

    expect({
      status: installation.status,
      integrityFailure: installation.stderr.includes("worker artifact integrity check failed"),
    }).toEqual({ status: 1, integrityFailure: true });
  } finally {
    await rm(home, { force: true, recursive: true });
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

test("unsafe existing worker destinations fail without changing the previous installation", async () => {
  const fixtureRoot = await createRepositoryFixture();
  const home = await mkdtemp(path.join(tmpdir(), "review-publication-worker-unsafe-"));
  try {
    expect(await runInstaller(home, fixtureRoot)).toEqual({ status: 0, stderr: "" });
    const worker = path.join(home, installedWorkerRelativePath);
    const wrapper = path.join(home, ".local", "bin", "review-publication");
    const service = path.join(home, ".config", "systemd", "user", "review-publication@.service");
    const before = {
      worker: await readFile(worker, "utf8"),
      wrapper: await readFile(wrapper, "utf8"),
      service: await readFile(service, "utf8"),
    };
    await chmod(worker, 0o644);

    const installation = await runInstaller(home, fixtureRoot);

    expect({
      status: installation.status,
      refusedUnsafeWorker: installation.stderr.includes("worker destination is unsafe"),
      worker: await readFile(worker, "utf8"),
      workerMode: (await stat(worker)).mode & 0o777,
      wrapper: await readFile(wrapper, "utf8"),
      service: await readFile(service, "utf8"),
    }).toEqual({
      status: 1,
      refusedUnsafeWorker: true,
      worker: before.worker,
      workerMode: 0o644,
      wrapper: before.wrapper,
      service: before.service,
    });
  } finally {
    await rm(home, { force: true, recursive: true });
    await rm(fixtureRoot, { force: true, recursive: true });
  }
});

async function createRepositoryFixture() {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "review-publication-repository-"));
  await mkdir(path.join(fixtureRoot, "skills"), { recursive: true });
  await Promise.all([
    cp(path.join(repositoryRoot, "review-publication"), path.join(fixtureRoot, "review-publication"), { recursive: true }),
    cp(path.join(repositoryRoot, "skills", "review-change"), path.join(fixtureRoot, "skills", "review-change"), { recursive: true }),
  ]);
  return fixtureRoot;
}

async function runInstaller(home: string, fixtureRoot: string) {
  const environment = await isolatedInstallerEnvironment({
    home,
    repositoryRoot: fixtureRoot,
    platform: "Linux",
    nodeExecutable,
  });
  const processRef = Bun.spawn(["bash", path.join(fixtureRoot, "review-publication", "install.sh")], {
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

async function runWorkerValidation(wrapper: string) {
  const processRef = Bun.spawn([wrapper, "--validate-github-executable", process.execPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [status, stdout, stderr] = await Promise.all([
    processRef.exited,
    new Response(processRef.stdout).text(),
    new Response(processRef.stderr).text(),
  ]);
  return { status, stdout, stderr };
}
