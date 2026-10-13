import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, isAbsolute, join } from "node:path";

function sdkNearCli(cli: string): string | undefined {
  let directory = dirname(realpathSync(cli));
  for (let depth = 0; depth < 8; depth++) {
    const packageFile = join(directory, "package.json");
    if (existsSync(packageFile)) {
      const metadata = JSON.parse(readFileSync(packageFile, "utf8"));
      const sdkFile = join(directory, "dist/index.js");
      if (metadata.name === "@earendil-works/pi-coding-agent" && existsSync(sdkFile)) return sdkFile;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  return undefined;
}

function wrappedCli(file: string): string | undefined {
  if (statSync(file).size > 4096) return undefined;
  const match = readFileSync(file, "utf8").match(/\bexec\s+"([^"\n]+)"\s+"\$@"/);
  return match && isAbsolute(match[1]) && existsSync(match[1]) ? match[1] : undefined;
}

export function installedSdkFile(executable = Bun.which("pi")): string {
  if (!executable) throw new Error("An installed Pi executable is required for resource discovery");
  let cli = realpathSync(executable);
  for (let hop = 0; hop < 4; hop++) {
    const sdk = sdkNearCli(cli);
    if (sdk) return sdk;
    const wrapped = wrappedCli(cli);
    if (!wrapped) break;
    cli = realpathSync(wrapped);
  }
  throw new Error("Cannot locate the installed Pi SDK from its executable; check the Pi installation layout");
}

export function installedAiFile(sdkFile: string): string {
  // Node resolution handles packages with a require export; Pi 0.99.2's import-only
  // export requires the equivalent bounded node_modules search from the selected SDK.
  try { return createRequire(sdkFile).resolve("@earendil-works/pi-ai"); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ERR_PACKAGE_PATH_NOT_EXPORTED" && code !== "MODULE_NOT_FOUND") throw error;
  }
  let directory = dirname(realpathSync(sdkFile));
  for (let depth = 0; depth < 12; depth++) {
    const packageDir = join(directory, "node_modules/@earendil-works/pi-ai");
    const manifest = join(packageDir, "package.json");
    const file = join(packageDir, "dist/index.js");
    if (existsSync(manifest) && existsSync(file)) {
      const metadata = JSON.parse(readFileSync(manifest, "utf8"));
      if (metadata.name === "@earendil-works/pi-ai") return file;
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error("The installed Pi SDK has no matching AI dependency");
}
