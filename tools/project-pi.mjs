// Discover a pre-installed build/test dependency; never provision or update Pi.
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join, sep } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkSdkCache, sdkCacheDirectory, validateSdkCache } from "./pi-sdk-cache.mjs";

export function projectPiExecutable() {
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!isAbsolute(directory) || /[\r\n\0]/.test(directory)) continue;
    try {
      const executable = realpathSync(join(directory, "pi"));
      // Mise's Unix shims are symlinks to mise itself, not a Pi installation.
      if (basename(executable) === "mise") continue;
      if (!statSync(executable).isFile()) continue;
      accessSync(executable, constants.X_OK);
      return executable;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(error.code)) throw error;
    }
  }
  throw new Error("Cannot find a pre-installed Pi executable on an absolute PATH entry outside mise shims; install Pi separately and add it to PATH before building or testing");
}

// Inspect Node's selected-host dependency paths without loading packages or requiring exports.
export function projectPiPeer(sdkRoot, name) {
  const boundary = sdkCacheDirectory(sdkRoot);
  const require = createRequire(join(realpathSync(sdkRoot), "dist/index.js"));
  for (const directory of (require.resolve.paths(name) ?? []).slice(0, 12)) {
    if (boundary && !directory.startsWith(`${boundary}${sep}`)) continue;
    let path;
    try { path = realpathSync(join(directory, name)); }
    catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) continue;
      throw error;
    }
    if (boundary && !path.startsWith(`${boundary}${sep}`)) throw Error("Pi SDK peer is outside its checkout-local tree");
    try {
      const manifest = join(path, "package.json"), info = statSync(manifest);
      if (!info.isFile() || info.size > 65536) throw Error("Invalid metadata");
      if (!boundary && JSON.parse(readFileSync(manifest, "utf8")).name !== name) throw Error("Unexpected package name");
    } catch {
      throw Error(`Invalid installed Pi peer metadata: ${name}`);
    }
    return path;
  }
  throw Error(`The installed Pi host is missing its ${name} peer`);
}

function packageNearCli(cli) {
  let directory = dirname(cli);
  for (let depth = 0; depth < 8; depth++) {
    const file = join(directory, "package.json");
    if (existsSync(file) && statSync(file).size <= 65536) {
      const metadata = JSON.parse(readFileSync(file, "utf8"));
      if (metadata.name === "@earendil-works/pi-coding-agent" && existsSync(join(directory, "dist/index.js"))) return directory;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
}

function installedPi(executable) {
  let cli = realpathSync(executable);
  for (let hop = 0; hop < 4; hop++) {
    const root = packageNearCli(cli);
    if (root) return { cli, sdkRoot: root };
    if (statSync(cli).size > 4096) break;
    const wrapper = readFileSync(cli, "utf8").match(/\bexec\s+"([^"\n]+)"\s+"\$@"/);
    if (!wrapper || !isAbsolute(wrapper[1]) || !existsSync(wrapper[1])) break;
    cli = realpathSync(wrapper[1]);
  }
  return { cli };
}

export function projectPiSdkDirectory(version) {
  if (typeof version !== "string" || version.length > 128
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw Error("Cannot determine an exact installed Pi version; expected a release version from pi --version");
  }
  return fileURLToPath(new URL(`../target/pi-sdk/${version}/`, import.meta.url));
}

function standaloneVersion(cli) {
  const run = spawnSync(cli, ["--version"], { encoding: "utf8", timeout: 10000, killSignal: "SIGKILL", maxBuffer: 4096 });
  if (run.error || run.status !== 0) throw Error("Cannot read the installed standalone Pi version with pi --version");
  const version = run.stdout.trim();
  projectPiSdkDirectory(version);
  return version;
}

export function projectPiHost(executable = projectPiExecutable()) {
  const { cli, sdkRoot } = installedPi(executable);
  if (sdkRoot) {
    const { version } = JSON.parse(readFileSync(join(sdkRoot, "package.json"), "utf8"));
    return { executable: cli, packageRoot: sdkRoot, sdkRoot, version, standalone: false };
  }
  const version = standaloneVersion(cli);
  return { executable: cli, packageRoot: dirname(cli), version, standalone: true };
}

export function projectPiPackage(executable = projectPiExecutable()) {
  const host = projectPiHost(executable);
  if (host.sdkRoot) return host.sdkRoot;
  const directory = projectPiSdkDirectory(host.version);
  try {
    checkSdkCache(directory);
    if (existsSync(join(directory, ".restore-lock"))) throw Error("SDK restoration is in progress");
    const ready = join(directory, ".ready");
    if (statSync(ready).size > 128 || readFileSync(ready, { encoding: "utf8", flag: constants.O_RDONLY | constants.O_NOFOLLOW }) !== host.version) throw Error("Incomplete restoration");
    return validateSdkCache(directory, host.version);
  } catch { /* Missing or invalid SDKs need an explicit build, never an implicit download. */ }
  throw Error(`Standalone Pi ${host.version} needs its exact-version SDK; run make build-pi-sdk to restore checkout-local dependencies`);
}
