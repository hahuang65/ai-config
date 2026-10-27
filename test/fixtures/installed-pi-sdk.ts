import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { projectPiPackage } from "../../tools/project-pi.mjs";

export function installedSdkFile(executable?: string): string {
  return join(projectPiPackage(executable), "dist/index.js");
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
