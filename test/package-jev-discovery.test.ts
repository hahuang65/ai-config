import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { standaloneFixture } from "./fixtures/standalone-pi";

const node = execFileSync("node", ["-p", "process.execPath"], { encoding: "utf8" }).trim();

function put(path: string, text: string, executable = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  if (executable) chmodSync(path, 0o755);
}

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "jev-discovery-")));
  const source = join(root, "source"), bin = join(root, "bin"), marker = join(root, "executed");
  mkdirSync(source);
  mkdirSync(bin);
  const input = join(root, "request.json");
  put(input, JSON.stringify({ state: { task: "Synthetic evidence" }, questions: { check: {
    type: "bool", instructions: "Is the evidence relevant?", criteria: { true: "Relevant", false: "Not relevant" },
  } } }));
  const run = () => spawnSync(node, [resolve("harnesses/pi/jev-bridge.mjs"), input], {
    encoding: "utf8", timeout: 10000,
    env: { PATH: bin, HOME: root, PI_CODING_AGENT_DIR: join(root, ".pi/agent"), AI_REVIEW_EXCLUDED_SOURCES: JSON.stringify([source]) },
  });
  return { root, source, bin, marker, run, clean: () => rmSync(root, { recursive: true, force: true }) };
}

test.each(["root", "entry"])("standalone SDK discovery refuses an excluded cache %s without restoring it", kind => {
  const setup = standaloneFixture();
  try {
    const excluded = kind === "root" ? setup.sdk : join(setup.sdk, "dist/index.js");
    const result = spawnSync(node, ["--input-type=module", "-e",
      `import { projectPiPackage } from ${JSON.stringify(join(setup.root, "tools/project-pi.mjs"))};\nconsole.log(projectPiPackage(${JSON.stringify(setup.executable)}));`], {
      encoding: "utf8", timeout: 10000, env: { PATH: setup.root, HOME: setup.root, AI_REVIEW_EXCLUDED_SOURCES: JSON.stringify([excluded]) },
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(existsSync(join(setup.root, "npm-calls"))).toBe(false);
  } finally { rmSync(setup.root, { recursive: true, force: true }); }
});

test("native Jev SDK discovery refuses launcher chains beyond its inspection bound", () => {
  const f = fixture();
  try {
    const executable = join(f.source, "pi");
    put(executable, `#!/bin/sh\nprintf executed > "${f.marker}"\nprintf '1.5.2\\n'\n`, true);
    let target = executable;
    for (let index = 0; index < 5; index++) {
      const wrapper = join(f.bin, index === 4 ? "pi" : `wrapper-${index}`);
      put(wrapper, `#!/bin/sh\nexec "${target}" "$@"\n`, true);
      target = wrapper;
    }
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("unavailable");
    expect(existsSync(f.marker)).toBe(false);
  } finally { f.clean(); }
});

test("native Jev SDK discovery refuses an SDK entry symlink into reviewed source", () => {
  const f = fixture();
  try {
    const sdk = join(f.root, "installed-sdk");
    put(join(sdk, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent", version: "1.5.2", type: "module" }));
    const cli = join(sdk, "dist/cli.js");
    put(cli, "fixture CLI\n");
    const entry = join(f.source, "entry.mjs");
    put(entry, `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(f.marker)}, 'executed');\nthrow Error('Synthetic SDK');\n`);
    symlinkSync(entry, join(sdk, "dist/index.js"));
    put(join(f.bin, "pi"), `#!/bin/sh\nexec "${cli}" "$@"\n`, true);
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("unavailable");
    expect(existsSync(f.marker)).toBe(false);
  } finally { f.clean(); }
});

test("native Jev SDK discovery refuses a trusted-directory wrapper targeting reviewed source", () => {
  const f = fixture();
  try {
    const executable = join(f.source, "pi");
    put(executable, `#!/bin/sh\nprintf executed > "${f.marker}"\nprintf '1.5.2\\n'\n`, true);
    put(join(f.bin, "pi"), `#!/bin/sh\nexec "${executable}" "$@"\n`, true);
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("unavailable");
    expect(existsSync(f.marker)).toBe(false);
  } finally { f.clean(); }
});

test("native Jev SDK discovery never executes an outside PATH alias into reviewed source", () => {
  const f = fixture();
  try {
    const executable = join(f.source, "pi");
    put(executable, `#!/bin/sh\nprintf executed > "${f.marker}"\nprintf '1.5.2\\n'\n`, true);
    symlinkSync(executable, join(f.bin, "pi"));
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout).status).toBe("unavailable");
    expect(existsSync(f.marker)).toBe(false);
  } finally { f.clean(); }
});
