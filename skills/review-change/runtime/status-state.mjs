import {
  sanitizeTelemetryLine,
  sanitizeTerminalLine as safeLine,
  sanitizeTerminalSummary as safeMultiline,
  terminalLinePreview,
} from "./terminal-text.mjs";
import { describeToolCall, summarizeToolResult } from "./tool-activity.mjs";

export const STAGES = [
  { id: "target", label: "Resolve target", description: "Freeze immutable review scope" },
  { id: "workspace", label: "Create isolation", description: "Snapshot source in a disposable clone" },
  { id: "review", label: "Adversarial review", description: "Review the complete change against intent" },
  { id: "evidence", label: "Targeted evidence", description: "Run smallest checks that prove intent" },
  { id: "documentation", label: "Documentation", description: "Check changed documentation and claims" },
  { id: "lint", label: "Lint", description: "Run focused deterministic quality checks" },
  { id: "report", label: "Build report", description: "Assemble the retained results-only HTML" },
  { id: "summary", label: "Summary", description: "Present retained results and stage outcomes" },
  { id: "cleanup", label: "Cleanup on exit", description: "Remove the isolated workspace after review" },
];

export const VALIDATION_STAGES = ["review", "evidence", "documentation", "lint", "report"];

const STAGE_IDS = new Set(STAGES.map(({ id }) => id));
const MAX_LOG_LINES = 200;

export function createState() {
  return {
    stages: new Map(STAGES.map((stage) => [stage.id, {
      ...stage, status: "pending", detail: "", substage: "", logs: [], omittedLogEntries: 0,
      telemetryStarted: false, telemetryStepped: false,
    }])),
    currentStage: null,
    startedAt: null,
    finishedAt: null,
    exitCode: null,
    summary: "",
    finalSummary: [],
    finalSummaryPlain: [],
    finalSummaryMarkdown: "",
    finalSummaryRendered: false,
    summaryRenderWidth: null,
    context: { target: "", intent: "", scope: "", workspace: "", report: "", fullLog: "" },
    findingCount: 0,
    risk: "unknown",
    toolRuns: new Map(),
    telemetryLog: null,
    telemetryDetached: false,
    lifecycleFailure: null,
    lifecycleFailureHandler: null,
    pendingTelemetry: [],
    pendingProgress: new Map(),
    telemetryInvalid: false,
  };
}

export function beginStage(state, stage, label, timestamp) {
  if (!STAGE_IDS.has(stage)) return;
  const current = state.stages.get(stage);
  state.stages.set(stage, { ...current, label: safeLine(label), status: "running", startedAt: timestamp });
  state.currentStage = stage;
}

export function finishStage(state, stage, status, detail, timestamp) {
  if (!STAGE_IDS.has(stage)) return;
  const current = state.stages.get(stage);
  state.stages.set(stage, { ...current, status, detail: safeLine(detail), finishedAt: timestamp });
}

export function applyPiEvent(state, event, timestamp, line) {
  if (!event || typeof event !== "object") return;
  if (event.type === "tool_execution_start" && event.toolName === "review_change_status") {
    if (event.toolCallId) state.pendingProgress.set(event.toolCallId, event.args);
    return;
  }
  if (event.type === "tool_execution_start") {
    recordToolStart(state, event, timestamp, line);
    return;
  }
  if (event.type === "tool_execution_end") {
    recordToolEnd(state, event, timestamp, line);
    return;
  }
  if (event.type === "message_end" && event.message?.role === "assistant") {
    state.summary = assistantText(event.message);
  }
}

function recordToolStart(state, event, timestamp, line) {
  const activity = describeToolCall(event.toolName, event.args);
  if (!activity) return;
  const stage = state.currentStage ?? "review";
  addLog(state, stage, event.toolName, activity, timestamp);
  if (event.toolCallId) {
    state.toolRuns.set(event.toolCallId, { stage, toolName: event.toolName, startedAt: timestamp });
  }
  line(`  · ${activity}`);
}

function recordToolEnd(state, event, timestamp, line) {
  const progress = state.pendingProgress.get(event.toolCallId);
  if (!progress) {
    completeToolCall(state, event, timestamp, line);
    return;
  }
  state.pendingProgress.delete(event.toolCallId);
  if (!event.isError) applyProgressEvent(state, progress, timestamp, line);
  else rejectProgressEvent(state, progress.stage, "status tool failed", timestamp, line);
}

function completeToolCall(state, event, timestamp, line) {
  const run = state.toolRuns.get(event.toolCallId);
  if (!run) return;
  state.toolRuns.delete(event.toolCallId);
  const outcome = event.isError ? "failed" : "completed";
  const evidence = summarizeToolResult(run.toolName, event.result);
  const message = `${run.toolName} ${outcome} ${elapsed(run.startedAt, timestamp)}${evidence ? ` — ${evidence}` : ""}`;
  addLog(state, run.stage, event.isError ? "error" : "result", message, timestamp);
  line(`  · ${message}`);
}

function applyProgressEvent(state, args, timestamp, line) {
  const stage = typeof args?.stage === "string" ? args.stage : "";
  const action = typeof args?.action === "string" ? args.action : "";
  const message = typeof args?.message === "string" ? args.message : "";
  if (!VALIDATION_STAGES.includes(stage)) return rejectProgressEvent(state, stage, "unknown stage", timestamp, line);
  const current = state.stages.get(stage);
  if (action === "start") return startTelemetryStage(state, stage, message, args, timestamp, line);
  if (!current.telemetryStarted || !["running", "waiting"].includes(current.status)) {
    return rejectProgressEvent(state, stage, `${action} without an active stage`, timestamp, line);
  }
  if (action === "complete" && !current.telemetryStepped) {
    return rejectProgressEvent(state, stage, "complete without an observable sub-stage", timestamp, line);
  }
  if (action === "wait" && current.status !== "running") {
    return rejectProgressEvent(state, stage, "unsupported wait transition", timestamp, line);
  }
  applyProgressMetrics(state, args);
  if (action === "step") return recordProgressStep(state, stage, message, timestamp, line);
  if (action === "log") return recordProgressLog(state, stage, message, timestamp, line, "  ·", "log");
  if (action === "complete") return completeProgressStage(state, stage, "passed", "result", "✓", message, timestamp, line);
  if (action === "fail") return completeProgressStage(state, stage, "failed", "error", "✗", message, timestamp, line);
  if (action === "wait") {
    return completeProgressStage(state, stage, "waiting", "status", "Ⅱ", message, timestamp, line);
  }
  return rejectProgressEvent(state, stage, `unsupported ${action} transition`, timestamp, line);
}

function startTelemetryStage(state, stage, message, args, timestamp, line) {
  const index = VALIDATION_STAGES.indexOf(stage);
  const previousPassed = index === 0 || state.stages.get(VALIDATION_STAGES[index - 1])?.status === "passed";
  const current = state.stages.get(stage);
  if (!previousPassed || current.telemetryStarted || ["passed", "failed"].includes(current.status)) {
    return rejectProgressEvent(state, stage, "start is out of order or repeated", timestamp, line);
  }
  applyProgressMetrics(state, args);
  beginStage(state, stage, labelFor(state, stage), timestamp);
  state.stages.set(stage, { ...state.stages.get(stage), telemetryStarted: true });
  recordProgressLog(state, stage, message, timestamp, line, `  ◐ ${labelFor(state, stage)}`);
}

function completeProgressStage(state, stage, status, kind, mark, message, timestamp, line) {
  finishStage(state, stage, status, message, timestamp);
  addLog(state, stage, kind, message, timestamp);
  line(`  ${mark} ${labelFor(state, stage)}${message ? ` — ${message}` : ""}`);
}

function recordProgressStep(state, stage, message, timestamp, line) {
  const current = state.stages.get(stage);
  const resumed = current.status === "waiting";
  state.stages.set(stage, {
    ...current,
    status: "running",
    detail: resumed ? "" : current.detail,
    finishedAt: resumed ? undefined : current.finishedAt,
    substage: safeLine(message),
    telemetryStepped: true,
  });
  addLog(state, stage, "step", message, timestamp);
  line(`  ↳ ${labelFor(state, stage)} — ${message}`);
}

function recordProgressLog(state, stage, message, timestamp, line, prefix = "  ·", kind = "status") {
  addLog(state, stage, kind, message, timestamp);
  const separator = prefix === "  ·" ? " " : " — ";
  line(`${prefix}${message ? `${separator}${message}` : ""}`);
}

function applyProgressMetrics(state, args) {
  if (Number.isInteger(args?.findings) && args.findings >= 0) state.findingCount = args.findings;
  if (["low", "medium", "high"].includes(args?.risk)) state.risk = args.risk;
}

function rejectProgressEvent(state, stage, reason, timestamp, line) {
  state.telemetryInvalid = true;
  const owner = STAGE_IDS.has(stage) ? stage : state.currentStage ?? "review";
  const message = `invalid stage transition: ${safeLine(reason)}`;
  addLog(state, owner, "error", message, timestamp);
  line(`  ✗ ${message}`);
}

export function addLog(state, stage, kind, message, timestamp) {
  const current = state.stages.get(stage);
  if (!current) return;
  const fullEntry = {
    stage: sanitizeTelemetryLine(stage),
    kind: sanitizeTelemetryLine(kind),
    message: String(message),
    timestamp,
  };
  persistTelemetryEntry(state, fullEntry);
  const preview = terminalLinePreview(fullEntry.message);
  const retainedLogs = [...current.logs, {
    kind: fullEntry.kind,
    message: preview.text,
    omittedCharacters: preview.omittedCharacters,
    timestamp,
  }];
  const newlyOmittedEntries = Math.max(0, retainedLogs.length - MAX_LOG_LINES);
  state.stages.set(stage, {
    ...current,
    logs: retainedLogs.slice(-MAX_LOG_LINES),
    omittedLogEntries: current.omittedLogEntries + newlyOmittedEntries,
  });
}

function persistTelemetryEntry(state, entry) {
  if (!state.telemetryLog) {
    if (!state.telemetryDetached) state.pendingTelemetry.push(entry);
    return;
  }
  try {
    state.telemetryLog.append(entry);
  } catch (error) {
    failTelemetryPersistence(state, error);
  }
}

function failTelemetryPersistence(state, error) {
  if (state.lifecycleFailure) return;
  const telemetryLog = state.telemetryLog;
  state.telemetryLog = null;
  state.telemetryDetached = true;
  const detail = error instanceof Error ? error.message : String(error);
  const appendFailure = new Error(`telemetry persistence failed: ${detail}`, { cause: error });
  let closeFailure = null;
  try {
    telemetryLog?.close();
  } catch (closeError) {
    closeFailure = closeError;
  }
  state.lifecycleFailure = closeFailure
    ? new AggregateError([appendFailure, closeFailure], "telemetry append and immediate close failed")
    : appendFailure;
  state.lifecycleFailureHandler?.(state.lifecycleFailure);
}

export function labelFor(state, stage) {
  return state.stages.get(stage)?.label ?? stage;
}

export function elapsed(startedAt, finishedAt) {
  return startedAt === null || startedAt === undefined ? "" : `(${elapsedPlain(startedAt, finishedAt)})`;
}

export function elapsedPlain(startedAt, finishedAt) {
  if (startedAt === null || startedAt === undefined) return "0.0s";
  const seconds = Math.max(0, finishedAt - startedAt) / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}

function assistantText(message) {
  const text = Array.isArray(message.content)
    ? message.content.filter((part) => part?.type === "text").map((part) => part.text).join("")
    : "";
  return safeMultiline(text);
}
