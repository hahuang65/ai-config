// Restore a library SDK locally; never install a global client or change PATH.
import { constants, existsSync, mkdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { projectPiHost, projectPiSdkDirectory } from "./project-pi.mjs";
import { checkSdkCache, validateSdkCache } from "./pi-sdk-cache.mjs";

const host = projectPiHost();
if (host.sdkRoot) {
  console.log("Using the installed Pi SDK");
} else {
  restoreSdk();
}

function restoreSdk() {
  const directory = projectPiSdkDirectory(host.version);
  checkSdkCache(directory, true);
  const lock = join(directory, ".restore-lock");
  try { mkdirSync(lock); }
  catch { throw Error("Pi SDK restoration is already locked; inspect the checkout-local .restore-lock before retrying"); }
  try {
    const ready = join(directory, ".ready");
    if (existsSync(ready)) unlinkSync(ready);
    const manifest = { name: "ai-config-pi-sdk", private: true,
      dependencies: { "@earendil-works/pi-coding-agent": host.version } };
    const file = join(directory, "package.json");
    const text = JSON.stringify(manifest, null, 2) + "\n";
    if (!existsSync(file) || readFileSync(file, { encoding: "utf8", flag: constants.O_RDONLY | constants.O_NOFOLLOW }) !== text) {
      writeFileSync(file, text, { flag: constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW });
    }
    checkSdkCache(directory);
    const command = existsSync(join(directory, "package-lock.json")) ? "ci" : "install";
    console.log(`Restoring checkout-local Pi SDK ${host.version} (no scripts or executable links)`);
    const run = spawnSync("npm", [command, "--package-lock=true", "--ignore-scripts", "--bin-links=false", "--global=false",
      "--no-audit", "--no-fund", "--fetch-retries=1", "--fetch-timeout=30000"], {
      cwd: directory, stdio: "ignore", timeout: 120000, killSignal: "SIGKILL",
    });
    if (run.error || run.status !== 0) throw Error(`Cannot restore Pi SDK ${host.version}; check npm availability, registry access, and that this exact release is published`);
    checkSdkCache(directory);
    if (!existsSync(join(directory, "package-lock.json"))) throw Error("Pi SDK restoration did not produce a lockfile");
    validateSdkCache(directory, host.version);
    writeFileSync(ready, host.version, { flag: "wx" });
  } finally { rmdirSync(lock); }
}
