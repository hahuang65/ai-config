const MAX_LOG_LENGTH = 300;

export function sanitizeTerminalLine(value) {
  const plain = stripControls(String(value)).replace(/[\u0000-\u001f\u007f]/g, " ");
  return redactSecrets(plain).replace(/\s+/g, " ").trim().slice(0, MAX_LOG_LENGTH);
}

export function sanitizeTerminalSummary(value) {
  const plain = stripControls(String(value)).replace(/[^\n\t\u0020-\u007e\u00a0-\uffff]/g, "");
  return redactSecrets(plain);
}

function stripControls(value) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function redactSecrets(value) {
  return value
    .replace(/\b(https?:\/\/)[^/\s@]+@/gi, "$1[REDACTED]@")
    .replace(/(authorization\s*:\s*)(?:bearer|basic)\s+[^\s'\"]+/gi, "$1[REDACTED]")
    .replace(/\bbearer\s+[^\s'\"]+/gi, "Bearer [REDACTED]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+|npm_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]")
    .replace(/((?:api[_-]?key|token|password|secret)\s*[=:]\s*)[^\s]+/gi, "$1[REDACTED]");
}
