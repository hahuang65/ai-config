import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { writeSdkTree } from "./pi-sdk-tree.mjs";

const source = fileURLToPath(new URL("../../", import.meta.url));

export function standaloneFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-standalone-")));
  mkdirSync(join(root, "tools"));
  for (const file of ["project-pi.mjs", "pi-sdk-cache.mjs"]) {
    cpSync(join(source, "tools", file), join(root, "tools", file));
  }
  const executable = join(root, "pi");
  writeFileSync(executable, '#!/bin/sh\n[ "$1" = "--version" ] || exit 99\nprintf "1.4.0\\n"\n', { mode: 0o755 });
  const sdk = writeSdkTree(join(root, "target/pi-sdk/1.4.0"));
  return { root, executable, sdk };
}

export function sdkBuildFixture() {
  const setup = standaloneFixture();
  rmSync(join(setup.root, "target"), { recursive: true });
  cpSync(join(source, "tools/build-pi-sdk.mjs"), join(setup.root, "tools/build-pi-sdk.mjs"));
  writeFileSync(join(setup.root, "npm"), `#!${process.execPath}
import { appendFileSync, rmSync } from 'node:fs';
import { writeSdkTree, restoreSdkTree } from ${JSON.stringify(join(source, "test/fixtures/pi-sdk-tree.mjs"))};
appendFileSync(${JSON.stringify(join(setup.root, "npm-calls"))}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');
if (process.argv.includes('ci')) restoreSdkTree(process.cwd());
else {
  writeSdkTree(process.cwd(), '1.4.0', false);
  if (process.env.npm_config_package_lock === 'false' && !process.argv.includes('--package-lock=true')) {
    rmSync('package-lock.json');
  }
}
`, { mode: 0o755 });
  return setup;
}

export function buildSdk(setup: ReturnType<typeof standaloneFixture>, env: NodeJS.ProcessEnv = {}) {
  return spawnSync("node", [join(setup.root, "tools/build-pi-sdk.mjs")], {
    cwd: setup.root, encoding: "utf8", timeout: 10000,
    env: { ...process.env, ...env, PATH: `${setup.root}:${process.env.PATH}` },
  });
}

export function discover(setup: ReturnType<typeof standaloneFixture>) {
  return spawnSync("node", ["--input-type=module", "-e",
    `import { projectPiPackage } from ${JSON.stringify(join(setup.root, "tools/project-pi.mjs"))};
     console.log(projectPiPackage(${JSON.stringify(setup.executable)}));`], {
    encoding: "utf8", timeout: 10000,
    env: { ...process.env, PATH: `${setup.root}:${process.env.PATH}` },
  });
}
