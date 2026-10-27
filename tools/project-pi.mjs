// Discover a pre-installed build/test dependency; never provision or update Pi.
import { accessSync, constants, existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { basename, delimiter, dirname, isAbsolute, join } from "node:path";
import { createRequire } from "node:module";

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
  const require = createRequire(join(realpathSync(sdkRoot), "dist/index.js"));
  for (const directory of (require.resolve.paths(name) ?? []).slice(0, 12)) {
    let path;
    try { path = realpathSync(join(directory, name)); }
    catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) continue;
      throw error;
    }
    try {
      const manifest = join(path, "package.json"), info = statSync(manifest);
      if (!info.isFile() || info.size > 65536) throw Error("Invalid metadata");
      if (JSON.parse(readFileSync(manifest, "utf8")).name !== name) throw Error("Unexpected package name");
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

export function projectPiPackage(executable = projectPiExecutable()) {
  let cli = realpathSync(executable);
  for (let hop = 0; hop < 4; hop++) {
    const root = packageNearCli(cli);
    if (root) return root;
    if (statSync(cli).size > 4096) break;
    const wrapper = readFileSync(cli, "utf8").match(/\bexec\s+"([^"\n]+)"\s+"\$@"/);
    if (!wrapper || !isAbsolute(wrapper[1]) || !existsSync(wrapper[1])) break;
    cli = realpathSync(wrapper[1]);
  }
  throw new Error("Cannot locate the installed Pi SDK from its executable; check the Pi installation layout");
}
