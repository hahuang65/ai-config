import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const viewerErrorLimit = 4_096;

export async function openReportArtifact(reportRoot, dependencies = {}) {
  const readDirectory = dependencies.readDirectory ?? readdir;
  const spawnProcess = dependencies.spawnProcess ?? spawn;
  const platform = dependencies.platform ?? process.platform;
  const entries = await readDirectory(reportRoot, { withFileTypes: true });
  const reports = entries
    .filter((entry) => entry.isFile() && path.extname(entry.name).toLowerCase() === ".html")
    .map((entry) => path.join(reportRoot, entry.name));
  if (reports.length !== 1) {
    throw new Error(`expected one HTML report in ${reportRoot}, found ${reports.length}`);
  }
  const reportPath = reports[0];
  const { command, args, waitForExit } = viewerCommand(platform, reportPath);
  const stdio = waitForExit ? ["ignore", "ignore", "pipe"] : "ignore";
  const processOptions = dependencies.signal
    ? { stdio, signal: dependencies.signal }
    : { stdio };
  try {
    await waitForViewer({ command, args, processOptions, spawnProcess, waitForExit });
    return reportPath;
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    failure.reportPath = reportPath;
    throw failure;
  }
}

function waitForViewer({ command, args, processOptions, spawnProcess, waitForExit }) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess(command, args, processOptions);
    let stderr = "";
    child.stderr?.setEncoding?.("utf8");
    child.stderr?.on?.("data", (chunk) => {
      stderr = `${stderr}${chunk}`.slice(0, viewerErrorLimit);
    });
    child.once("error", reject);
    if (!waitForExit) {
      child.once("spawn", () => {
        child.unref?.();
        resolve();
      });
      return;
    }
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = stderr.replace(/\s+/g, " ").trim();
      const suffix = detail ? `: ${detail}` : "";
      reject(new Error(`${command} exited with status ${code ?? "unknown"}${suffix}`));
    });
  });
}

function viewerCommand(platform, reportPath) {
  if (platform === "darwin") {
    const reportUrl = pathToFileURL(reportPath).href;
    return {
      command: "osascript",
      args: [
        "-e",
        'set firefoxApp to application "Firefox"',
        "-e",
        "tell firefoxApp",
        "-e",
        "activate",
        "-e",
        `«event GURLGURL» "${reportUrl}"`,
        "-e",
        "end tell",
      ],
      waitForExit: true,
    };
  }
  if (platform === "win32") {
    return { command: "explorer.exe", args: [reportPath], waitForExit: false };
  }
  return { command: "xdg-open", args: [reportPath], waitForExit: false };
}
