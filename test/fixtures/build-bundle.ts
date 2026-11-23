import { execFileSync } from "node:child_process";

// A fresh build process isolates resolution from earlier fixture activity.
export function builtNodeBundle(entrypoint: string): string {
  return execFileSync("bun", ["build", entrypoint, "--target", "node", "--format", "esm"], {
    encoding: "utf8", timeout: 5000, maxBuffer: 1024 * 1024,
  });
}
