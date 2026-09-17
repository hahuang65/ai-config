import { spawn } from "node:child_process";
import path from "node:path";

import {
  OS_CONFIRMATION_TIMEOUT_MS,
  PROCESS_TERMINATION_GRACE_MS,
} from "./review-publication-lifetime.mjs";

const PROMPT_TIMEOUT_SECONDS = 60;
const APPROVAL_LABEL = "Post review";

export function createOperatingSystemConfirmation({ promptRunner } = {}) {
  const runPrompt = promptRunner ?? (async () => ({ outcome: "unavailable" }));
  return async (claims, review, context = {}) => {
    const prompt = publicationPrompt(claims, review);
    const response = await runPrompt({ prompt, signal: context.signal });
    if (response?.outcome === "approved") return;
    throw confirmationError(response?.outcome);
  };
}

export function createOperatingSystemPromptRunner({
  platform,
  executable,
  spawnProcess = spawn,
  timeoutMs = OS_CONFIRMATION_TIMEOUT_MS,
  terminationGraceMs = PROCESS_TERMINATION_GRACE_MS,
} = {}) {
  return async ({ prompt, signal }) => {
    if (!isSupportedPlatform(platform) || !isAbsoluteExecutable(executable)) {
      return { outcome: "unavailable" };
    }
    return runPromptProcess({
      args: promptArguments(platform, prompt),
      executable,
      platform,
      signal,
      spawnProcess,
      terminationGraceMs,
      timeoutMs,
    });
  };
}

function publicationPrompt(claims, review) {
  const selectedCount = review.findings.length;
  return [
    "Approve this GitHub Review publication?",
    "",
    `GitHub actor: @${claims.actor.login} (ID ${claims.actor.id})`,
    `Repository: ${claims.repository.nameWithOwner} (ID ${claims.repository.id})`,
    `Pull request: #${claims.pullRequest.number} (ID ${claims.pullRequest.id})`,
    `Base commit: ${claims.scope.baseOid}`,
    `Head commit: ${claims.scope.headOid}`,
    `Selected Findings: ${selectedCount}`,
    `Inline comments included: ${selectedCount > 0 ? "Yes" : "No"}`,
    "",
    "Choose Post review only if you want to publish this exact review now.",
  ].join("\n");
}

function promptArguments(platform, prompt) {
  if (platform === "macos") {
    const script = `display dialog ${appleScriptString(prompt)} with title "Review publication" buttons {"Cancel", "${APPROVAL_LABEL}"} default button "${APPROVAL_LABEL}" cancel button "Cancel" with icon caution giving up after ${PROMPT_TIMEOUT_SECONDS}`;
    return ["-e", script];
  }
  return [
    "--question",
    "--title=Review publication",
    `--text=${prompt}`,
    `--ok-label=${APPROVAL_LABEL}`,
    "--cancel-label=Cancel",
    `--timeout=${PROMPT_TIMEOUT_SECONDS}`,
    "--no-wrap",
  ];
}

function runPromptProcess(options) {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) return reject(cancellationError());
    let child;
    try {
      child = options.spawnProcess(options.executable, options.args, {
        env: confirmationEnvironment(),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      return resolve({ outcome: unavailableProcess(error) ? "unavailable" : "failed" });
    }
    observePromptProcess(child, options, resolve, reject);
  });
}

function observePromptProcess(child, options, resolve, reject) {
  const stdout = [];
  const stderr = [];
  let termination = "";
  let settled = false;
  let forceTimer;
  const settle = (error, response) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutTimer);
    clearTimeout(forceTimer);
    options.signal?.removeEventListener("abort", cancel);
    if (error) reject(error); else resolve(response);
  };
  const forceSettle = () => {
    child.kill("SIGKILL");
    child.stdout?.destroy?.();
    child.stderr?.destroy?.();
    child.unref?.();
    settle(termination === "cancelled" ? cancellationError() : null, { outcome: "timeout" });
  };
  const terminate = (reason) => {
    if (termination) return;
    termination = reason;
    child.kill("SIGTERM");
    forceTimer = setTimeout(forceSettle, options.terminationGraceMs);
  };
  const cancel = () => terminate("cancelled");
  options.signal?.addEventListener("abort", cancel, { once: true });
  const timeoutTimer = setTimeout(() => terminate("timeout"), options.timeoutMs);
  timeoutTimer.unref?.();
  if (options.signal?.aborted) cancel();
  child.stdout?.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr?.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  child.once("error", (error) => {
    if (termination === "cancelled") return settle(cancellationError());
    if (termination === "timeout") return settle(null, { outcome: "timeout" });
    settle(null, { outcome: unavailableProcess(error) ? "unavailable" : "failed" });
  });
  child.once("close", (status, processSignal) => {
    if (termination === "cancelled") return settle(cancellationError());
    if (termination === "timeout") return settle(null, { outcome: "timeout" });
    settle(null, interpretProcessResponse(options.platform, status, processSignal, stdout, stderr));
  });
}

function interpretProcessResponse(platform, status, processSignal, stdoutChunks, stderrChunks) {
  if (processSignal) return { outcome: "dismissed" };
  const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
  if (platform === "macos") {
    if (status === 0 && new RegExp(`^button returned:${APPROVAL_LABEL}(?:, gave up:false)?$`).test(stdout)) {
      return { outcome: "approved" };
    }
    if (status === 0 && /gave up:true/.test(stdout)) return { outcome: "timeout" };
    if (status === 1 && /User canceled|\(-128\)/i.test(stderr)) return { outcome: "denied" };
    if (status === 0) return { outcome: "malformed" };
    return { outcome: "failed" };
  }
  if (status === 0 && stdout === "") return { outcome: "approved" };
  if (/cannot open display|unable to init server|cannot connect|org\.freedesktop/i.test(stderr)) {
    return { outcome: "unavailable" };
  }
  if (status === 1) return { outcome: "denied" };
  if (status === 5) return { outcome: "timeout" };
  if (status === 0) return { outcome: "malformed" };
  return { outcome: "failed" };
}

function confirmationError(outcome) {
  const definitions = {
    denied: [403, "os_confirmation_denied", "Operating-system confirmation was denied"],
    dismissed: [403, "os_confirmation_dismissed", "Operating-system confirmation was dismissed"],
    timeout: [504, "os_confirmation_timeout", "Operating-system confirmation timed out"],
    unavailable: [503, "os_confirmation_unavailable", "Operating-system confirmation is unavailable"],
    malformed: [502, "os_confirmation_invalid_response", "Operating-system confirmation returned an invalid response"],
    failed: [503, "os_confirmation_failed", "Operating-system confirmation failed"],
  };
  const [status, code, message] = definitions[outcome] ?? definitions.malformed;
  return Object.assign(new Error(message), { status, code });
}

function cancellationError() {
  return Object.assign(new Error("Review publication request timed out"), {
    code: "request_timeout",
    status: 504,
  });
}

function appleScriptString(value) {
  return value.split("\n")
    .map((line) => `"${line.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`)
    .join(" & return & ");
}

function confirmationEnvironment() {
  const environment = {};
  for (const name of ["DISPLAY", "WAYLAND_DISPLAY", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS", "HOME", "USER", "LOGNAME", "LANG", "LC_ALL"]) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

function unavailableProcess(error) {
  return ["ENOENT", "EACCES"].includes(error?.code);
}

function isSupportedPlatform(value) {
  return value === "macos" || value === "linux";
}

function isAbsoluteExecutable(value) {
  return typeof value === "string" && path.isAbsolute(value);
}
