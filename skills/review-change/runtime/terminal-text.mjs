import {
  boundedPreview,
  redactCredentials,
  truncateText,
} from "../../shared/runtime/safe-preview.mjs";

const MAX_LOG_LENGTH = 300;

export function sanitizeTerminalLine(value) {
  return boundedPreview(sanitizeTelemetryLine(value), MAX_LOG_LENGTH).text;
}

export function terminalLinePreview(value) {
  return truncateText(sanitizeTelemetryLine(value), MAX_LOG_LENGTH);
}

export function sanitizeTelemetryLine(value) {
  const plain = redactCredentials(stripControls(String(value)));
  return plain.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function sanitizeTerminalSummary(value) {
  const plain = stripControls(String(value)).replace(/[^\n\t\u0020-\u007e\u00a0-\uffff]/g, "");
  return redactCredentials(plain);
}

function stripControls(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}
