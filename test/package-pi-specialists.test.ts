import { expect, test } from "bun:test";
import { cpSync, existsSync, readFileSync, realpathSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { delimiter, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { projectPiPackage } from "../tools/project-pi.mjs";
import { installedAiFile, installedSdkFile } from "./fixtures/installed-pi-sdk";
import { writeSdkTree } from "./fixtures/pi-sdk-tree.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

test("specialists pin their engine without provisioning a second Pi client", () => {
  const metadata = JSON.parse(readFileSync(`${root}/package.json`, "utf8"));
  expect(metadata.devDependencies["pi-subagents"]).toBe("0.83.0");
  expect(metadata.devDependencies["@earendil-works/pi-coding-agent"]).toBeUndefined();
  expect(readFileSync(`${root}/Makefile`, "utf8")).toContain("--omit peer");
});

test("the package owns both the specialist adapter and its read-only engine policy", () => {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8"));
  expect(manifest.links).toContainEqual({ destination: ".pi/agent/extensions/specialists.ts",
    target: "harnesses/pi/specialists.bundle.ts" });
  expect(manifest.links).toContainEqual({ destination: ".pi/agent/extensions/subagent/config.json",
    target: "harnesses/pi/specialists/policy.json" });
  expect(readFileSync(join(root, "Makefile"), "utf8")).toContain("build-pi-specialists");
});

test("the installed specialist bundle matches its owned source", async () => {
  const built = await Bun.build({ entrypoints: [join(root, "harnesses/pi/specialists.ts")],
    target: "node", format: "esm", external: ["@earendil-works/pi-coding-agent", "typebox"] });
  expect(built.success).toBe(true);
  expect(await built.outputs[0].text()).toBe(readFileSync(join(root, "harnesses/pi/specialists.bundle.ts"), "utf8"));
});

test("the built engine preserves its layout and shares the installed host peers", () => {
  const runtime = join(root, "target/pi-subagents");
  const file = join(runtime, "host.json");
  const host = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : undefined;
  expect(host?.engineVersion).toBe("0.83.0");
  expect(host.sdkRoot).toBe(projectPiPackage());
  expect(JSON.parse(readFileSync(join(runtime, "package/package.json"), "utf8")).name).toBe("pi-subagents");
  expect(existsSync(join(runtime, "package/src/runs/shared/child-session.js"))).toBe(true);
  for (const [name, path] of Object.entries(host.peers)) {
    expect(realpathSync(join(runtime, "node_modules", name))).toBe(path as string);
  }
});

function fakePackage(path: string, name: string, extra = {}) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "package.json"), JSON.stringify({ name, type: "module", ...extra }));
  writeFileSync(join(path, "index.js"), "throw Error('fixture packages must not execute');\n");
  return path;
}

function hoistedBuildFixture(temporary: string) {
  const project = join(temporary, "project"), bin = join(temporary, "bin");
  mkdirSync(join(project, "tools"), { recursive: true });
  mkdirSync(bin);
  for (const file of ["build-specialists.mjs", "project-pi.mjs", "pi-sdk-cache.mjs"]) {
    cpSync(join(root, "tools", file), join(project, "tools", file));
  }
  const engine = fakePackage(join(project, "node_modules/pi-subagents"), "pi-subagents", { version: "0.83.0" });
  mkdirSync(join(engine, "bundle"));
  writeFileSync(join(engine, "bundle/index.js"), "fixture; never run\n");
  writeFileSync(join(engine, "LICENSE"), "fixture license\n");
  for (const name of ["@js-temporal/polyfill", "acorn", "jiti", "undici", "yaml", "jsbi"]) {
    fakePackage(join(project, "node_modules", name), name);
  }
  const modules = join(temporary, "host/node_modules");
  const sdk = fakePackage(join(modules, "@earendil-works/pi-coding-agent"),
    "@earendil-works/pi-coding-agent", { version: "1.4.0" });
  mkdirSync(join(sdk, "dist"));
  writeFileSync(join(sdk, "dist/index.js"), "fixture; never run\n");
  const invoked = join(temporary, "client-invoked");
  writeFileSync(join(sdk, "dist/cli.js"), `#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(invoked)}, 'invoked');\nprocess.exit(99);\n`, { mode: 0o755 });
  symlinkSync(join(sdk, "dist/cli.js"), join(bin, "pi"));
  const peers: Record<string, string> = { "@earendil-works/pi-coding-agent": sdk };
  for (const name of ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-tui", "typebox"]) {
    const stored = fakePackage(join(temporary, "peer-store", name), name,
      { exports: { ".": { import: "./index.js" } } });
    mkdirSync(dirname(join(modules, name)), { recursive: true });
    symlinkSync(stored, join(modules, name), "dir");
    peers[name] = stored;
  }
  return { project, bin, sdk, peers, invoked };
}

test("runtime packaging resolves canonical hoisted import-only SDK peers without invoking a client", () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "pi-hoisted-build-")));
  try {
    const setup = hoistedBuildFixture(temporary);
    const result = spawnSync("node", [join(setup.project, "tools/build-specialists.mjs")], {
      cwd: setup.project, encoding: "utf8", timeout: 10000,
      env: { ...process.env, HOME: temporary, PATH: `${setup.bin}${delimiter}${process.env.PATH ?? ""}` },
    });
    expect(result.status, result.stderr).toBe(0);
    const runtime = join(setup.project, "target/pi-subagents");
    const host = JSON.parse(readFileSync(join(runtime, "host.json"), "utf8"));
    expect(host.sdkRoot).toBe(setup.sdk);
    expect(host.peers).toEqual(setup.peers);
    for (const [name, path] of Object.entries(setup.peers)) {
      expect(realpathSync(join(runtime, "node_modules", name))).toBe(path);
    }
    expect(existsSync(setup.invoked)).toBe(false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

test("standalone runtime packaging preserves a locked alias for a host peer", () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "pi-aliased-host-build-")));
  try {
    const setup = hoistedBuildFixture(temporary), directory = join(setup.project, "target/pi-sdk/1.4.0");
    const sdk = writeSdkTree(directory), name = "@earendil-works/pi-ai";
    const peer = join(directory, "node_modules", name), file = join(peer, "package.json");
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), name: "actual-pi-ai" }));
    const sdkFile = join(sdk, "package.json"), sdkMetadata = JSON.parse(readFileSync(sdkFile, "utf8"));
    sdkMetadata.dependencies[name] = "npm:actual-pi-ai@1.4.0";
    writeFileSync(sdkFile, JSON.stringify(sdkMetadata));
    const lockFile = join(directory, "package-lock.json"), lock = JSON.parse(readFileSync(lockFile, "utf8"));
    lock.packages[`node_modules/${name}`].name = "actual-pi-ai";
    lock.packages["node_modules/@earendil-works/pi-coding-agent"].dependencies = sdkMetadata.dependencies;
    writeFileSync(lockFile, JSON.stringify(lock));
    rmSync(join(setup.bin, "pi"));
    writeFileSync(join(setup.bin, "pi"), '#!/bin/sh\nprintf "1.4.0\\n"\n', { mode: 0o755 });
    const run = spawnSync("node", [join(setup.project, "tools/build-specialists.mjs")], {
      cwd: setup.project, encoding: "utf8", timeout: 10000,
      env: { ...process.env, HOME: temporary, PATH: `${setup.bin}${delimiter}${process.env.PATH ?? ""}` },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(realpathSync(join(setup.project, "target/pi-subagents/node_modules", name))).toBe(peer);
    expect(existsSync(setup.invoked)).toBe(false);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});

for (const [scenario, metadata] of [
  ["wrong-name", JSON.stringify({ name: "not-the-host-peer" })],
  ["malformed", "{PRIVATE_PEER_METADATA"],
  ["oversized", JSON.stringify({ name: "@earendil-works/pi-ai", padding: "x".repeat(65536) })],
]) {
  test(`runtime packaging refuses ${scenario} peer metadata before writing runtime files`, () => {
    const temporary = realpathSync(mkdtempSync(join(tmpdir(), "pi-invalid-peer-")));
    try {
      const setup = hoistedBuildFixture(temporary);
      writeFileSync(join(setup.peers["@earendil-works/pi-ai"], "package.json"), metadata);
      const result = spawnSync("node", [join(setup.project, "tools/build-specialists.mjs")], {
        cwd: setup.project, encoding: "utf8", timeout: 10000,
        env: { ...process.env, HOME: temporary, PATH: `${setup.bin}${delimiter}${process.env.PATH ?? ""}` },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("Invalid installed Pi peer metadata: @earendil-works/pi-ai");
      expect(result.stderr).not.toContain("PRIVATE_PEER_METADATA");
      expect(existsSync(join(setup.project, "target/pi-subagents"))).toBe(false);
      expect(existsSync(setup.invoked)).toBe(false);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
}

function runFixture(mode = "normal") {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), "pi-specialists-")));
  const home = join(temporary, "home"), cwd = join(temporary, "project");
  const agentDir = join(home, ".pi/agent");
  mkdirSync(cwd, { recursive: true });
  try {
    const sdk = installedSdkFile();
    const result = spawnSync("node", [join(root, "test/fixtures/pi-specialists.mjs"), sdk,
      installedAiFile(sdk), root, cwd, mode], { cwd, encoding: "utf8", timeout: 45000,
      env: { HOME: home, TMPDIR: temporary, PI_CODING_AGENT_DIR: agentDir,
        PI_OFFLINE: "1", PATH: process.env.PATH, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
        ...(mode === "host-override" ? { PI_SUBAGENTS_PI_CODING_AGENT_PACKAGE_ROOT: join(temporary, "foreign-sdk") } : {}) } });
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

test("native specialists preserve the role body, context and a read-only tool floor", () => {
  const evidence = runFixture();
  expect(evidence.registered, JSON.stringify(evidence.errors)).toBe(true);
  expect(evidence.errors).toEqual([]);
  expect(evidence.requests).toHaveLength(1);
  const request = evidence.requests[0];
  expect(request.system).toContain("# API designer");
  for (const marker of ["GLOBAL_SPECIALIST_TEST", "PROJECT_SPECIALIST_TEST", "SKILL_SPECIALIST_TEST"]) {
    expect(request.system).toContain(marker);
  }
  expect(request.tools).toEqual(["read", "grep", "find", "ls"]);
  expect(Object.keys(evidence.schema.properties)).toEqual(["agent", "task"]);
  expect(evidence.executionMode).toBe("sequential");
  expect(evidence.result.isError).not.toBe(true);
}, 50000);

test("the actual child guard permits source reading but refuses credentials", () => {
  const evidence = runFixture("guard-probe");
  expect(evidence.errors).toEqual([]);
  expect(evidence.requests).toHaveLength(3);
  const messages = JSON.stringify(evidence.requests.at(-1).messages);
  expect(messages).toContain("PUBLIC_SPECIALIST_SOURCE");
  expect(messages).toContain("Refused — credential file read: .aws/credentials");
  expect(messages).not.toContain("PRIVATE_CREDENTIAL_CANARY");
  expect(evidence.result.isError).not.toBe(true);
}, 50000);

for (const mode of ["forbidden-role", "forbidden-options"]) {
  test(`the native facade rejects ${mode} before any model request`, () => {
    const evidence = runFixture(mode);
    expect(evidence.requests).toHaveLength(0);
    expect(evidence.error).toContain("Specialists accept only an approved agent");
  }, 50000);
}

test("an incompatible host override is rejected before registering the engine", () => {
  const evidence = runFixture("host-override");
  expect(evidence.registered).toBe(false);
  expect(evidence.requests).toHaveLength(0);
  expect(JSON.stringify(evidence.errors)).toContain("host override");
}, 50000);

test("policy changes after startup cannot enable a later delegation", () => {
  const evidence = runFixture("policy-changed");
  expect(evidence.requests).toHaveLength(0);
  expect(evidence.error).toContain("read-only policy");
}, 50000);

test("malformed private policy fails closed without quoting its contents", () => {
  const evidence = runFixture("policy-invalid");
  expect(evidence.registered).toBe(false);
  expect(evidence.requests).toHaveLength(0);
  expect(JSON.stringify(evidence.errors)).toContain("read-only policy");
  expect(JSON.stringify(evidence.errors)).not.toContain("PRIVATE_PO");
}, 50000);

test("a failed host-floor registration cannot launch an unguarded specialist", () => {
  const evidence = runFixture("floor-collision");
  expect(evidence.errors.length).toBeGreaterThan(0);
  expect(evidence.requests).toHaveLength(0);
  expect(evidence.error).toContain("guard floor is not ready");
}, 50000);
