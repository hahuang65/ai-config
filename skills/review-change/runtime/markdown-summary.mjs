import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_OUTPUT_BYTES = 1_024 * 1_024;

export async function renderMarkdownWithGlow(markdown, options = {}) {
  const spawnProcess = options.spawnProcess ?? spawn;
  const width = Math.max(20, Number(options.width) || 80);
  const style = options.color === false ? "notty" : "dark";
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const environment = { ...process.env };
  if (options.color === false) {
    environment.NO_COLOR = "1";
    delete environment.CLICOLOR_FORCE;
  } else {
    environment.CLICOLOR_FORCE = "1";
    delete environment.NO_COLOR;
  }

  return new Promise((resolve) => {
    let child;
    try {
      child = spawnProcess(
        "glow",
        ["--style", style, "--width", String(width), "--preserve-new-lines", "-"],
        { stdio: ["pipe", "pipe", "ignore"], env: environment },
      );
    } catch {
      resolve(null);
      return;
    }

    let settled = false;
    let output = "";
    let timeoutTimer = null;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      options.signal?.removeEventListener?.("abort", terminate);
      resolve(value);
    };
    const terminate = () => {
      child.kill?.("SIGKILL");
      child.stdin?.destroy?.();
      child.stdout?.destroy?.();
      child.unref?.();
      settle(null);
    };

    if (options.signal?.aborted) return terminate();
    options.signal?.addEventListener?.("abort", terminate, { once: true });
    timeoutTimer = setTimeout(terminate, timeout);
    timeoutTimer.unref?.();

    child.once("error", () => settle(null));
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
      if (Buffer.byteLength(output) > MAX_OUTPUT_BYTES) terminate();
    });
    child.once("close", (code) => {
      if (code !== 0 || settled) return settle(null);
      const rendered = sanitizeGlowOutput(output, options.color !== false).trimEnd();
      settle(rendered || null);
    });
    child.stdin?.once?.("error", terminate);
    child.stdin?.end(markdown);
  });
}

function sanitizeGlowOutput(value, color) {
  const normalized = String(value).replace(/\r\n/g, "\n").replace(/\r/g, "");
  const withoutControlStrings = normalized
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\|\u009c|$)/g, "")
    .replace(/\u001b[PX^_][\s\S]*?(?:\u001b\\|\u009c|$)/g, "")
    .replace(/\u009d[\s\S]*?(?:\u0007|\u009c|$)/g, "")
    .replace(/[\u0090\u0098\u009e\u009f][\s\S]*?(?:\u009c|$)/g, "");
  const withoutUnsafeCsi = withoutControlStrings
    .replace(/\u001b\[[0-?]*[ -/]*(?:[@-~]|$)/g, (sequence) => {
      const safeSgr = /^\u001b\[[0-9;]*m$/.test(sequence);
      return color && safeSgr ? sequence : "";
    })
    .replace(/\u009b[0-?]*[ -/]*(?:[@-~]|$)/g, "")
    .replace(/\u001b(?!\[)[ -/]*[@-~]/g, "")
    .replace(/\u001b(?!\[[0-9;]*m)/g, "");
  return withoutUnsafeCsi.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f-\u009f]/g, "");
}
