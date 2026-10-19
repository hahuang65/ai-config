// Discover a pre-installed build/test dependency; never provision or update Pi.
import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join } from "node:path";

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
