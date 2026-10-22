import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Copy package source resources, never Git state, built tools, or private state. */
export function copyPackageFiles(destination: string) {
  const source = fileURLToPath(new URL("../../", import.meta.url));
  mkdirSync(destination, { recursive: true });
  for (const directory of ["skills", "agents", "commands", "rules", "guard", "harnesses"]) {
    cpSync(join(source, directory), join(destination, directory), { recursive: true });
  }
  for (const file of ["manifest.json", "language-servers.json", "baseline.md", "reviewer.md", "docs/worktree-transitions.md",
    "tools/worktree/src/completion.bash"]) {
    const target = join(destination, file);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(source, file), target);
  }
}
