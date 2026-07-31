import { sanitizeTerminalLine } from "./terminal-text.mjs";

export function renderBoundaryFailureSummary(error, exitCode) {
  const message = sanitizeTerminalLine(error instanceof Error ? error.message : String(error));
  return `Review change failed with exit ${exitCode}\nFailure: ${message}\n`;
}

export function renderTerminalSummary({ exitCode, target, intent, scope, report, findings, risk, stages }) {
  const outcome = exitCode === 0 ? "completed" : `failed with exit ${exitCode}`;
  const lines = [`Review change ${outcome}`];
  if (target) lines.push(`Target: ${sanitizeTerminalLine(target)}`);
  if (scope) lines.push(`Scope: ${sanitizeTerminalLine(scope)}`);
  if (intent) lines.push(`Intent: ${sanitizeTerminalLine(intent)}`);
  if (report) lines.push(`Report: ${sanitizeTerminalLine(report)}`);
  lines.push(`Risk: ${risk} · Open Findings: ${findings}`);
  lines.push("Stages:");
  for (const stage of stages) {
    const detail = stage.detail ? ` — ${sanitizeTerminalLine(stage.detail)}` : "";
    lines.push(`- ${stage.label}: ${stage.status}${detail}`);
  }
  return `${lines.join("\n")}\n`;
}
