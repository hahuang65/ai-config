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
  const plain = redactCredentials(value);
  return plain.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
}

export function sanitizeTelemetryText(value) {
  return redactCredentials(value);
}

export function sanitizeTerminalSummary(value) {
  return sanitizeTelemetryText(value).replace(/[^\n\t\u0020-\u007e\u00a0-\uffff]/g, "");
}
