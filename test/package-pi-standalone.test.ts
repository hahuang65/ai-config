import { expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { standaloneFixture, sdkBuildFixture, buildSdk, discover } from "./fixtures/standalone-pi";

const source = fileURLToPath(new URL("../", import.meta.url));
const sdkName = "@earendil-works/pi-coding-agent";

test("version discovery queries the selected executable and detects an in-place upgrade", () => {
  const setup = standaloneFixture();
  try {
    const calls = join(setup.root, "version-calls");
    const script = (version: string) => `#!/bin/sh\nprintf invoked >> ${JSON.stringify(calls)}\nprintf '${version}\\n'\n`;
    writeFileSync(setup.executable, script("1.4.0"), { mode: 0o755 });
    const run = spawnSync("node", ["--input-type=module", "-e",
      `import { projectPiHost } from ${JSON.stringify(join(setup.root, "tools/project-pi.mjs"))};
       import { writeFileSync } from 'node:fs';
       const first = projectPiHost(${JSON.stringify(setup.executable)}).version;
       const second = projectPiHost(${JSON.stringify(setup.executable)}).version;
       writeFileSync(${JSON.stringify(setup.executable)}, ${JSON.stringify(script("1.4.1"))});
       const upgraded = projectPiHost(${JSON.stringify(setup.executable)}).version;
       console.log(JSON.stringify([first, second, upgraded]));`], { encoding: "utf8", timeout: 10000 });
    expect(run.status, run.stderr).toBe(0);
    expect(JSON.parse(run.stdout)).toEqual(["1.4.0", "1.4.0", "1.4.1"]);
    expect(readFileSync(calls, "utf8")).toBe("invokedinvokedinvoked");
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("the explicit SDK build restores only the binary's exact version without scripts or executable links", () => {
  const setup = sdkBuildFixture();
  try {
    const run = buildSdk(setup);
    expect(run.status, run.stderr).toBe(0);
    const call = JSON.parse(readFileSync(join(setup.root, "npm-calls"), "utf8").trim());
    expect(call.cwd).toBe(join(setup.root, "target/pi-sdk/1.4.0"));
    for (const argument of ["install", "--ignore-scripts", "--bin-links=false", "--global=false"]) {
      expect(call.args).toContain(argument);
    }
    const metadata = JSON.parse(readFileSync(join(call.cwd, "package.json"), "utf8"));
    expect(metadata.dependencies[sdkName]).toBe("1.4.0");
    expect(discover(setup).stdout.trim()).toBe(setup.sdk);
    const lock = readFileSync(join(call.cwd, "package-lock.json"), "utf8");
    const stale = join(call.cwd, "node_modules/.previous-build");
    writeFileSync(stale, "disposable build output");
    expect(buildSdk(setup).status).toBe(0);
    const calls = readFileSync(join(setup.root, "npm-calls"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(calls).toHaveLength(2);
    expect(calls[1].args).toContain("ci");
    expect(readFileSync(join(call.cwd, "package-lock.json"), "utf8")).toBe(lock);
    expect(existsSync(stale)).toBe(false);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("restoration retains a lockfile and uses ci even when user npm configuration disables lockfiles", () => {
  const setup = sdkBuildFixture();
  try {
    const env = { npm_config_package_lock: "false" };
    expect(buildSdk(setup, env).status).toBe(0);
    const directory = join(setup.root, "target/pi-sdk/1.4.0");
    expect(existsSync(join(directory, "package-lock.json"))).toBe(true);
    const retained = readFileSync(join(directory, "package-lock.json"), "utf8");
    const stale = join(directory, "node_modules/.previous-build");
    writeFileSync(stale, "disposable build output");
    expect(buildSdk(setup, env).status).toBe(0);
    const calls = readFileSync(join(setup.root, "npm-calls"), "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(calls).toHaveLength(2);
    expect(calls[0].args).toContain("--package-lock=true");
    expect(calls[1].args).toContain("ci");
    expect(readFileSync(join(directory, "package-lock.json"), "utf8")).toBe(retained);
    expect(existsSync(stale)).toBe(false);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

for (const operation of ["version", "npm"]) {
  test(`${operation} discovery or restoration forcibly stops a child that ignores SIGTERM`, () => {
    const setup = sdkBuildFixture();
    let run: ReturnType<typeof spawnSync> | undefined;
    try {
      const hanging = operation === "version" ? setup.executable : join(setup.root, "npm");
      writeFileSync(hanging, '#!/bin/sh\ntrap "" TERM\nwhile :; do :; done\n', { mode: 0o755 });
      const preload = join(setup.root, "deadline.mjs");
      writeFileSync(preload, `import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { writeFileSync } from 'node:fs';
const spawn = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  writeFileSync(${JSON.stringify(join(setup.root, "deadline-options"))}, JSON.stringify(options));
  return spawn(command, args, { ...options, timeout: 100 });
};
syncBuiltinESMExports();\n`);
      run = spawnSync("node", ["--import", preload, join(setup.root, "tools/build-pi-sdk.mjs")], {
        cwd: setup.root, encoding: "utf8", timeout: 3000, killSignal: "SIGKILL", detached: true,
        env: { ...process.env, PATH: `${setup.root}:${process.env.PATH}` },
      });
      expect(run.status, run.stderr?.toString()).toBe(1);
      expect(run.error).toBeUndefined();
      const options = JSON.parse(readFileSync(join(setup.root, "deadline-options"), "utf8"));
      expect(options.timeout).toBe(operation === "version" ? 10000 : 120000);
    } finally {
      if (run?.pid) { try { process.kill(-run.pid, "SIGKILL"); } catch {} }
      rmSync(setup.root, { recursive: true, force: true });
    }
  }, 5000);
}

test("SDK restore failures report the exact release without exposing npm diagnostics or choosing another version", () => {
  const setup = sdkBuildFixture();
  try {
    writeFileSync(join(setup.root, "npm"), '#!/bin/sh\nprintf "PRIVATE_NPM_DIAGNOSTIC" >&2\nexit 1\n', { mode: 0o755 });
    const run = buildSdk(setup);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Cannot restore Pi SDK 1.4.0");
    expect(run.stderr).not.toContain("PRIVATE_NPM_DIAGNOSTIC");
    expect(existsSync(join(setup.root, "target/pi-sdk/1.4.0/.restore-lock"))).toBe(false);
    expect(discover(setup).status).toBe(1);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("an interrupted restore cannot leave a partial SDK discoverable", () => {
  const setup = sdkBuildFixture();
  try {
    const npm = join(setup.root, "npm");
    writeFileSync(npm, readFileSync(npm, "utf8") + "\nprocess.exit(1);\n", { mode: 0o755 });
    expect(buildSdk(setup).status).toBe(1);
    expect(existsSync(join(setup.sdk, "dist/index.js"))).toBe(true);
    expect(discover(setup).status).toBe(1);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("a successful npm exit without a lockfile cannot mark the SDK ready", () => {
  const setup = sdkBuildFixture();
  try {
    const npm = join(setup.root, "npm");
    writeFileSync(npm, readFileSync(npm, "utf8") + "\nrmSync('package-lock.json');\n", { mode: 0o755 });
    const run = buildSdk(setup);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Pi SDK restoration did not produce a lockfile");
    expect(existsSync(join(setup.root, "target/pi-sdk/1.4.0/.ready"))).toBe(false);
    expect(discover(setup).status).toBe(1);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("ordinary discovery never restores a missing SDK", () => {
  const setup = sdkBuildFixture();
  try {
    const run = discover(setup);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("make build-pi-sdk");
    expect(existsSync(join(setup.root, "npm-calls"))).toBe(false);
    expect(existsSync(join(setup.root, "target"))).toBe(false);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("discovery refuses a cached SDK from a different release without downloading a replacement", () => {
  const setup = standaloneFixture();
  try {
    writeFileSync(join(setup.sdk, "package.json"), JSON.stringify({ name: sdkName, version: "1.3.0" }));
    const run = discover(setup);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain("Standalone Pi 1.4.0 needs its exact-version SDK");
    expect(run.stderr).toContain("make build-pi-sdk");
    expect(existsSync(join(setup.root, "npm-calls"))).toBe(false);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("footer bundling uses the standalone binary's private SDK terminal helpers", () => {
  const setup = standaloneFixture();
  try {
    cpSync(join(source, "tools/build-status-footer.mjs"), join(setup.root, "tools/build-status-footer.mjs"));
    const modules = dirname(dirname(setup.sdk));
    const tui = join(modules, "@earendil-works/pi-tui");
    mkdirSync(join(tui, "dist"), { recursive: true });
    writeFileSync(join(tui, "package.json"), JSON.stringify({ name: "@earendil-works/pi-tui", version: "1.4.0", main: "dist/index.js",
      dependencies: { "get-east-asian-width": "1.0.0" } }));
    writeFileSync(join(tui, "dist/index.js"), "throw Error('do not load');");
    writeFileSync(join(tui, "dist/utils.js"), 'export const stringWidth = () => "EXACT_VERSION_TUI";');
    mkdirSync(join(modules, "get-east-asian-width"));
    writeFileSync(join(modules, "get-east-asian-width/package.json"),
      JSON.stringify({ name: "get-east-asian-width", version: "1.0.0", main: "index.js" }));
    writeFileSync(join(modules, "get-east-asian-width/index.js"), "module.exports = {};");
    mkdirSync(join(setup.root, "harnesses/pi"), { recursive: true });
    writeFileSync(join(setup.root, "harnesses/pi/status-footer.ts"),
      'export { stringWidth } from "@earendil-works/pi-tui";');
    const run = spawnSync(process.execPath, [join(setup.root, "tools/build-status-footer.mjs")], {
      cwd: setup.root, encoding: "utf8", timeout: 10000,
      env: { ...process.env, PATH: `${setup.root}:${process.env.PATH}` },
    });
    expect(run.status, run.stderr).toBe(0);
    expect(readFileSync(join(setup.root, "harnesses/pi/status-footer.bundle.ts"), "utf8")).toContain("EXACT_VERSION_TUI");
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("a standalone Pi resolves its exact-version private SDK without loading it", () => {
  const setup = standaloneFixture();
  try {
    const run = discover(setup);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout.trim()).toBe(setup.sdk);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});
