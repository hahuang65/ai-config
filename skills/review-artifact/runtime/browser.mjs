import { spawn } from "node:child_process";

export async function openBrowser(url, platform = process.platform) {
  const command = browserCommand(url, platform);
  await new Promise((resolve, reject) => {
    const child = spawn(command.executable, command.args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function browserCommand(url, platform) {
  if (platform === "darwin") return { executable: "open", args: [url] };
  if (platform === "win32") return { executable: "cmd", args: ["/c", "start", "", url] };
  return { executable: "xdg-open", args: [url] };
}
