// Build/test dependency selection only; never install or change the live Pi client.
import { spawnSync } from "node:child_process";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

export function projectPiExecutable() {
  const result = spawnSync("mise", ["which", "pi"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    encoding: "utf8", timeout: 10_000, maxBuffer: 64 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const path = result.stdout?.trim();
  if (result.error || result.status !== 0 || !path || !isAbsolute(path) || /[\r\n\0]/.test(path)) {
    throw new Error("Project Pi is unavailable; explicitly run mise install npm:@earendil-works/pi-coding-agent before building or testing");
  }
  return path;
}
