import { closeSync, mkdirSync, openSync, writeSync } from "node:fs";
import path from "node:path";

import { sanitizeTelemetryLine } from "./terminal-text.mjs";

const LOG_DIRECTORY = path.join(".git", "review-change");
const LOG_FILENAME = "telemetry.log";

export function createTelemetryLog(workspacePath, initialEntries = []) {
  const logDirectory = path.join(path.resolve(workspacePath), LOG_DIRECTORY);
  const logPath = path.join(logDirectory, LOG_FILENAME);
  mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
  const descriptor = openSync(logPath, "wx", 0o600);
  let closed = false;
  try {
    writeSync(descriptor, initialEntries.map(serializeEntry).join(""));
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  return {
    path: logPath,
    append(entry) {
      if (closed) throw new Error("telemetry log is closed");
      writeSync(descriptor, serializeEntry(entry));
    },
    close() {
      if (closed) return;
      closed = true;
      closeSync(descriptor);
    },
  };
}

function serializeEntry(entry) {
  return `${JSON.stringify({
    timestamp: entry.timestamp,
    stage: sanitizeTelemetryLine(entry.stage),
    kind: sanitizeTelemetryLine(entry.kind),
    message: sanitizeTelemetryLine(entry.message),
  })}\n`;
}
