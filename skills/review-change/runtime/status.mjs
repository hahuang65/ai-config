import { renderMarkdownWithGlow } from "./markdown-summary.mjs";
import { renderStatusScreen, terminalDisplayWidth } from "./screen.mjs";
import { renderTerminalSummary } from "./summary.mjs";
import {
  sanitizeTerminalLine as safeLine,
  sanitizeTerminalSummary as safeMultiline,
} from "./terminal-text.mjs";
import { describeToolCall, summarizeToolResult } from "./tool-activity.mjs";

const ESCAPE = "\u001b";
const STAGES = [
  { id: "target", label: "Resolve target", description: "Freeze immutable review scope" },
  { id: "workspace", label: "Create isolation", description: "Snapshot source in a disposable clone" },
  { id: "review", label: "Adversarial review", description: "Review the complete change against intent" },
  { id: "evidence", label: "Targeted evidence", description: "Run smallest checks that prove intent" },
  { id: "documentation", label: "Documentation", description: "Check changed documentation and claims" },
  { id: "lint", label: "Lint", description: "Run focused deterministic quality checks" },
  { id: "report", label: "Build report", description: "Assemble the retained results-only HTML" },
  { id: "cleanup", label: "Cleanup", description: "Remove only the isolated workspace" },
  { id: "summary", label: "Summary", description: "Present retained results and stage outcomes" },
];
const STAGE_IDS = new Set(STAGES.map(({ id }) => id));
const VALIDATION_STAGES = ["review", "evidence", "documentation", "lint", "report"];
const MAX_LOG_LINES = 200;
const SCROLL_LINES = 5;
const REDRAW_INTERVAL_MS = 250;

export function createTerminalStatus(options = {}) {
  return new TerminalStatus(options);
}

class TerminalStatus {
  constructor(options) {
    this.stream = options.stream ?? process.stderr;
    this.summaryStream = options.summaryStream ?? process.stdout;
    this.input = options.input ?? process.stdin;
    this.now = options.now ?? Date.now;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.fullScreen = Boolean(this.stream.isTTY);
    this.renderSummaryMarkdown = options.renderSummaryMarkdown
      ?? (this.stream === process.stderr ? renderMarkdownWithGlow : null);
    this.color = options.color ?? process.env.NO_COLOR === undefined;
    this.state = createState();
    this.redrawTimer = null;
    this.selectedStage = "target";
    this.followActive = true;
    this.expanded = false;
    this.showHelp = false;
    this.summaryOffset = 0;
    this.logOffset = 0;
    this.abortHandler = null;
    this.abortRequested = false;
    this.finalView = false;
    this.dismissFinal = null;
    this.previousRawMode = false;
    this.summaryRenderGeneration = 0;
    this.summaryRenderAbort = null;
    this.handleInput = this.handleInput.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  start(context = {}) {
    this.state.startedAt = this.now();
    this.state.context = {
      target: safeLine(context.target ?? ""),
      intent: safeLine(context.intent ?? ""),
      workspace: "",
    };
    if (!this.fullScreen) return this.emitLine("Review change");
    this.stream.write(`${ESCAPE}[?1049h${ESCAPE}[?25l`);
    this.stream.on?.("resize", this.handleResize);
    this.redrawTimer = this.setIntervalFn(() => this.redraw(), REDRAW_INTERVAL_MS);
    this.attachInput();
    this.redraw();
  }

  setScope(scope) {
    this.state.context.scope = safeLine(scope);
    this.redraw();
  }

  setWorkspacePath(workspacePath) {
    this.state.context.workspace = safeLine(workspacePath);
    this.redraw();
  }

  setReportPath(reportPath) {
    this.state.context.report = safeLine(reportPath);
    this.redraw();
  }

  activity(stage, kind, message) {
    addLog(this.state, stage, kind, message, this.now());
    this.emitLine(`  · ${safeLine(message)}`);
    this.redraw();
  }

  begin(stage, label) {
    const timestamp = this.now();
    beginStage(this.state, stage, label, timestamp);
    addLog(this.state, stage, "status", `Started ${label}`, timestamp);
    this.followCurrentStage();
    this.emitLine(`  ◐ ${label}`);
    this.redraw();
  }

  succeed(stage, detail = "") {
    const timestamp = this.now();
    finishStage(this.state, stage, "passed", detail, timestamp);
    const suffix = detail ? ` — ${safeLine(detail)}` : "";
    const outcome = `${detail || "Completed"} ${elapsed(this.state.stages.get(stage)?.startedAt, timestamp)}`;
    addLog(this.state, stage, "result", outcome, timestamp);
    this.emitLine(`  ✓ ${labelFor(this.state, stage)}${suffix} ${elapsed(this.state.stages.get(stage)?.startedAt, timestamp)}`);
    this.redraw();
  }

  fail(stage, error) {
    const timestamp = this.now();
    const detail = error instanceof Error ? error.message : String(error);
    finishStage(this.state, stage, "failed", detail, timestamp);
    addLog(this.state, stage, "error", `${detail} ${elapsed(this.state.stages.get(stage)?.startedAt, timestamp)}`, timestamp);
    this.emitLine(`  ✗ ${labelFor(this.state, stage)} — ${safeLine(detail)} ${elapsed(this.state.stages.get(stage)?.startedAt, timestamp)}`);
    this.redraw();
  }

  processStarted() {
    beginStage(this.state, "review", labelFor(this.state, "review"), this.now());
    this.followCurrentStage();
    this.emitLine(`  ◐ ${labelFor(this.state, "review")}`);
    this.redraw();
  }

  processExit(exitCode) {
    const stage = this.state.currentStage ?? "review";
    addLog(this.state, stage, "process", `pi exited with status ${exitCode}`, this.now());
    this.emitLine(`  · pi exited with status ${exitCode}`);
    if (exitCode !== 0) {
      const activeStage = this.state.currentStage ?? "review";
      if (this.state.stages.get(activeStage)?.status !== "failed") {
        finishStage(this.state, activeStage, "failed", `pi exited with status ${exitCode}`, this.now());
      }
      this.redraw();
      return exitCode;
    }
    const incomplete = VALIDATION_STAGES.filter((stage) => this.state.stages.get(stage)?.status !== "passed");
    for (const stage of incomplete) {
      if (this.state.stages.get(stage)?.status === "failed") continue;
      finishStage(this.state, stage, "failed", "stage telemetry incomplete", this.now());
      this.emitLine(`  ✗ ${labelFor(this.state, stage)} — stage telemetry incomplete`);
    }
    this.redraw();
    return incomplete.length === 0 && !this.state.telemetryInvalid ? 0 : 1;
  }

  piEvent(event) {
    applyPiEvent(this.state, event, this.now(), (line) => this.emitLine(line));
    this.followCurrentStage();
    this.redraw();
  }

  childError(message) {
    for (const childLine of String(message).split(/\r?\n/).filter(Boolean)) {
      addLog(this.state, this.state.currentStage ?? "review", "stderr", childLine, this.now());
      this.emitLine(`  · ${safeLine(childLine)}`);
    }
    this.redraw();
  }

  async finish(exitCode) {
    this.state.exitCode = exitCode;
    this.state.finishedAt = this.now();
    if (this.redrawTimer !== null) this.clearIntervalFn(this.redrawTimer);
    const parentSummary = renderTerminalSummary({
      exitCode,
      ...this.state.context,
      findings: this.state.findingCount,
      risk: this.state.risk,
      stages: STAGES.filter(({ id }) => id !== "summary").map(({ id }) => this.state.stages.get(id)),
    });
    const assistantSummary = this.state.summary ? `\nAssistant summary:\n${this.state.summary.trimEnd()}\n` : "";
    if (!this.fullScreen) {
      this.emitFinalLine(exitCode);
      this.summaryStream.write(parentSummary);
      if (assistantSummary) this.summaryStream.write(assistantSummary);
      return;
    }

    const timestamp = this.now();
    const outcome = exitCode === 0 ? "Review complete" : `Failed with exit ${exitCode}`;
    beginStage(this.state, "summary", "Summary", timestamp);
    finishStage(this.state, "summary", exitCode === 0 ? "passed" : "failed", outcome, timestamp);
    this.state.currentStage = "summary";
    const plainSummary = `${parentSummary}${assistantSummary}`.trimEnd();
    this.state.finalSummaryPlain = plainSummary.split("\n");
    this.state.finalSummaryMarkdown = summaryMarkdown(parentSummary, this.state.summary);
    this.state.finalSummary = this.state.finalSummaryPlain;
    if (this.renderSummaryMarkdown) await this.refreshRenderedSummary();
    this.selectedStage = "summary";
    this.summaryOffset = 0;
    this.logOffset = 0;
    this.followActive = false;
    this.finalView = true;
    const canWait = this.input?.isTTY && typeof this.input.setRawMode === "function";
    if (!canWait) {
      this.redraw();
      this.restoreTerminal();
      this.summaryStream.write(parentSummary);
      if (assistantSummary) this.summaryStream.write(assistantSummary);
      return;
    }
    const dismissal = new Promise((resolve) => { this.dismissFinal = resolve; });
    this.redraw();
    await dismissal;
    this.restoreTerminal();
  }

  setAbortHandler(handler) {
    this.abortHandler = handler;
    if (handler && this.abortRequested) handler("SIGINT");
  }

  interrupt() {
    if (!this.finalView) return;
    const dismiss = this.dismissFinal;
    this.dismissFinal = null;
    dismiss?.();
  }

  emitLine(text) {
    if (!this.fullScreen) this.stream.write(`${text}\n`);
  }

  redraw() {
    if (!this.fullScreen) return;
    if (this.finalView && this.renderSummaryMarkdown) {
      const width = this.summaryPaneWidth();
      if (this.state.summaryRenderWidth !== width) void this.refreshRenderedSummary(width);
    }
    const view = {
      selectedStage: this.selectedStage,
      expanded: this.expanded,
      showHelp: this.showHelp,
      summaryOffset: this.summaryOffset,
      logOffset: this.logOffset,
    };
    this.stream.write(renderStatusScreen({
      state: this.state,
      stream: this.stream,
      timestamp: this.now(),
      view,
      stages: STAGES,
      formatDuration: elapsedPlain,
      color: this.color,
    }));
  }

  summaryPaneWidth() {
    const width = Math.max(1, this.stream.columns ?? 100);
    const height = Math.max(1, this.stream.rows ?? 30);
    if (width < 88 || height < 12) return width;
    return width - Math.max(40, Math.min(58, Math.floor(width * 0.52))) - 1;
  }

  async refreshRenderedSummary(width = this.summaryPaneWidth()) {
    if (!this.renderSummaryMarkdown || !this.state.finalSummaryMarkdown) return;
    if (width < 20) {
      this.summaryRenderAbort?.abort();
      this.summaryRenderAbort = null;
      this.summaryRenderGeneration += 1;
      this.state.summaryRenderWidth = width;
      this.state.finalSummary = this.state.finalSummaryPlain;
      this.state.finalSummaryRendered = false;
      this.clampSummaryOffset();
      if (this.finalView) this.redraw();
      return;
    }
    this.summaryRenderAbort?.abort();
    const controller = new AbortController();
    this.summaryRenderAbort = controller;
    const generation = ++this.summaryRenderGeneration;
    this.state.summaryRenderWidth = width;
    this.state.finalSummary = this.state.finalSummaryPlain;
    this.state.finalSummaryRendered = false;
    this.clampSummaryOffset();
    let rendered = null;
    try {
      rendered = await this.renderSummaryMarkdown(this.state.finalSummaryMarkdown, {
        width,
        color: this.color,
        signal: controller.signal,
      });
    } catch {
      rendered = null;
    }
    if (generation !== this.summaryRenderGeneration) return;
    this.summaryRenderAbort = null;
    this.state.finalSummary = rendered ? rendered.split("\n") : this.state.finalSummaryPlain;
    this.state.finalSummaryRendered = Boolean(rendered);
    this.clampSummaryOffset();
    if (this.finalView) this.redraw();
  }

  maximumSummaryOffset() {
    const width = Math.max(1, this.stream.columns ?? 100);
    const height = Math.max(1, this.stream.rows ?? 30);
    const summaryWidth = this.summaryPaneWidth();
    const lineCount = this.state.finalSummaryRendered
      ? this.state.finalSummary.length
      : this.state.finalSummary.reduce((count, line) => (
        count + Math.max(1, Math.ceil(terminalDisplayWidth(line) / summaryWidth))
      ), 0);
    return Math.max(0, lineCount - this.summaryViewportCapacity(width, height));
  }

  clampSummaryOffset() {
    this.summaryOffset = Math.max(0, Math.min(this.summaryOffset, this.maximumSummaryOffset()));
  }

  maximumLogOffset() {
    const selected = this.state.stages.get(this.selectedStage ?? this.state.currentStage ?? "target");
    if (!selected || selected.logs.length === 0) return 0;
    const width = Math.max(1, this.stream.columns ?? 100);
    const height = Math.max(1, this.stream.rows ?? 30);
    const paneWidth = width >= 88 && height >= 12
      ? width - Math.max(40, Math.min(58, Math.floor(width * 0.52))) - 1
      : width;
    const messageWidth = Math.max(20, paneWidth - 19);
    const lineCount = this.expanded
      ? selected.logs.reduce((count, log) => (
        count + Math.max(1, Math.ceil(terminalDisplayWidth(log.message) / messageWidth))
      ), 0)
      : selected.logs.length;
    return Math.max(0, lineCount - this.logViewportCapacity(width, height));
  }

  summaryViewportCapacity(width, height) {
    if (width < 32 || height < 12) return Math.max(0, height - (height < 5 ? 2 : 4));
    return this.logViewportCapacity(width, height);
  }

  logViewportCapacity(width, height) {
    if (width >= 88 && height >= 12) return Math.max(1, height - 7);
    if (width < 32 || height < 12) {
      if (height < 5) return Math.max(0, height - 3);
      return Math.max(0, height - (height >= 7 ? 6 : 5));
    }
    const stageRows = Math.min(STAGES.length, Math.max(1, height - 12));
    return Math.max(1, height - stageRows - 11);
  }

  clampLogOffset() {
    this.logOffset = Math.max(0, Math.min(this.logOffset, this.maximumLogOffset()));
  }

  handleResize() {
    if (this.finalView && this.renderSummaryMarkdown) {
      void this.refreshRenderedSummary();
      this.redraw();
      return;
    }
    this.redraw();
  }

  restoreTerminal() {
    this.finalView = false;
    this.summaryRenderGeneration += 1;
    this.summaryRenderAbort?.abort();
    this.summaryRenderAbort = null;
    this.stream.removeListener?.("resize", this.handleResize);
    this.redraw();
    this.detachInput();
    this.stream.write(`${ESCAPE}[?25h${ESCAPE}[?1049l`);
  }

  attachInput() {
    if (!this.input?.isTTY || typeof this.input.setRawMode !== "function") return;
    this.previousRawMode = Boolean(this.input.isRaw);
    this.input.setRawMode(true);
    this.input.on("data", this.handleInput);
    this.input.resume?.();
  }

  detachInput() {
    if (!this.input?.isTTY || typeof this.input.setRawMode !== "function") return;
    this.input.removeListener("data", this.handleInput);
    this.input.setRawMode(this.previousRawMode);
    this.input.pause?.();
  }

  handleInput(chunk) {
    const key = String(chunk);
    if (this.finalView && key === "\u0003") {
      const dismiss = this.dismissFinal;
      this.dismissFinal = null;
      dismiss?.();
      return;
    }
    if (this.finalView && new Set(["q", "x", "\u001b"]).has(key)) return;
    const viewingSummary = this.finalView && this.selectedStage === "summary";
    if (viewingSummary && new Set(["\u0015", "\u001b[5~"]).has(key)) {
      this.clampSummaryOffset();
      this.summaryOffset = Math.max(0, this.summaryOffset - SCROLL_LINES);
    } else if (viewingSummary && new Set(["\u0004", "\u001b[6~"]).has(key)) {
      this.summaryOffset = Math.min(this.maximumSummaryOffset(), this.summaryOffset + SCROLL_LINES);
    } else if (key === "\u0015") {
      this.logOffset = Math.min(this.maximumLogOffset(), this.logOffset + SCROLL_LINES);
    } else if (key === "\u0004") {
      this.logOffset = Math.max(0, this.logOffset - SCROLL_LINES);
    } else if (key === "k") this.selectRelative(-1);
    else if (key === "j") this.selectRelative(1);
    else if (key === "f") {
      this.followActive = true;
      this.logOffset = 0;
      this.followCurrentStage();
    } else if (key === "\r") {
      this.expanded = !this.expanded;
      this.clampLogOffset();
    } else if (key === "?") this.showHelp = !this.showHelp;
    else if (key === "\u0003") this.requestAbort();
    this.redraw();
  }

  selectRelative(offset) {
    const currentIndex = Math.max(0, STAGES.findIndex(({ id }) => id === this.selectedStage));
    const nextIndex = Math.max(0, Math.min(STAGES.length - 1, currentIndex + offset));
    this.selectedStage = STAGES[nextIndex].id;
    this.followActive = false;
    this.logOffset = 0;
  }

  followCurrentStage() {
    if (!this.followActive || !this.state.currentStage || this.selectedStage === this.state.currentStage) return;
    this.selectedStage = this.state.currentStage;
    this.logOffset = 0;
  }

  requestAbort() {
    if (this.abortHandler) this.abortHandler("SIGINT");
    else this.abortRequested = true;
  }

  emitFinalLine(exitCode) {
    const symbol = exitCode === 0 ? "✓" : "✗";
    const outcome = exitCode === 0 ? "completed" : `failed with exit ${exitCode}`;
    this.emitLine(`${symbol} Review change ${outcome} ${elapsed(this.state.startedAt, this.now())}`);
  }
}

function createState() {
  return {
    stages: new Map(STAGES.map((stage) => [stage.id, {
      ...stage, status: "pending", detail: "", substage: "", logs: [], telemetryStarted: false, telemetryStepped: false,
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
    context: { target: "", intent: "", scope: "", workspace: "", report: "" },
    findingCount: 0,
    risk: "unknown",
    toolRuns: new Map(),
    pendingProgress: new Map(),
    telemetryInvalid: false,
  };
}

function beginStage(state, stage, label, timestamp) {
  if (!STAGE_IDS.has(stage)) return;
  const current = state.stages.get(stage);
  state.stages.set(stage, { ...current, label: safeLine(label), status: "running", startedAt: timestamp });
  state.currentStage = stage;
}

function finishStage(state, stage, status, detail, timestamp) {
  if (!STAGE_IDS.has(stage)) return;
  const current = state.stages.get(stage);
  state.stages.set(stage, { ...current, status, detail: safeLine(detail), finishedAt: timestamp });
}

function applyPiEvent(state, event, timestamp, line) {
  if (!event || typeof event !== "object") return;
  if (event.type === "tool_execution_start" && event.toolName === "review_change_status") {
    if (event.toolCallId) state.pendingProgress.set(event.toolCallId, event.args);
    return;
  }
  if (event.type === "tool_execution_start") {
    const activity = describeToolCall(event.toolName, event.args);
    if (!activity) return;
    const stage = state.currentStage ?? "review";
    addLog(state, stage, event.toolName, activity, timestamp);
    if (event.toolCallId) state.toolRuns.set(event.toolCallId, { stage, toolName: event.toolName, startedAt: timestamp });
    line(`  · ${activity}`);
    return;
  }
  if (event.type === "tool_execution_end") {
    const progress = state.pendingProgress.get(event.toolCallId);
    if (progress) {
      state.pendingProgress.delete(event.toolCallId);
      if (!event.isError) applyProgressEvent(state, progress, timestamp, line);
      else rejectProgressEvent(state, progress.stage, "status tool failed", timestamp, line);
      return;
    }
    completeToolCall(state, event, timestamp, line);
    return;
  }
  if (event.type === "message_end" && event.message?.role === "assistant") {
    state.summary = assistantText(event.message);
  }
}

function completeToolCall(state, event, timestamp, line) {
  const run = state.toolRuns.get(event.toolCallId);
  if (!run) return;
  state.toolRuns.delete(event.toolCallId);
  const outcome = event.isError ? "failed" : "completed";
  const evidence = summarizeToolResult(run.toolName, event.result);
  const message = safeLine(`${run.toolName} ${outcome} ${elapsed(run.startedAt, timestamp)}${evidence ? ` — ${evidence}` : ""}`);
  addLog(state, run.stage, event.isError ? "error" : "result", message, timestamp);
  line(`  · ${message}`);
}

function applyProgressEvent(state, args, timestamp, line) {
  const stage = typeof args?.stage === "string" ? args.stage : "";
  const action = typeof args?.action === "string" ? args.action : "";
  const message = safeLine(args?.message ?? "");
  if (!VALIDATION_STAGES.includes(stage)) return rejectProgressEvent(state, stage, "unknown stage", timestamp, line);
  const current = state.stages.get(stage);
  if (action === "start") return startTelemetryStage(state, stage, message, args, timestamp, line);
  if (!current.telemetryStarted || !new Set(["running", "waiting"]).has(current.status)) {
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
  if (!previousPassed || current.telemetryStarted || new Set(["passed", "failed"]).has(current.status)) {
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
    substage: message,
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
  if (new Set(["low", "medium", "high"]).has(args?.risk)) state.risk = args.risk;
}

function rejectProgressEvent(state, stage, reason, timestamp, line) {
  state.telemetryInvalid = true;
  const owner = STAGE_IDS.has(stage) ? stage : state.currentStage ?? "review";
  const message = `invalid stage transition: ${safeLine(reason)}`;
  addLog(state, owner, "error", message, timestamp);
  line(`  ✗ ${message}`);
}

function addLog(state, stage, kind, message, timestamp) {
  const current = state.stages.get(stage);
  if (!current) return;
  const logs = [...current.logs, { kind: safeLine(kind), message: safeLine(message), timestamp }].slice(-MAX_LOG_LINES);
  state.stages.set(stage, { ...current, logs });
}

function summaryMarkdown(parentSummary, assistantSummary) {
  const lines = parentSummary.trimEnd().split("\n");
  const outcome = lines.shift() ?? "Review change";
  const stageIndex = lines.indexOf("Stages:");
  const details = stageIndex === -1 ? lines : lines.slice(0, stageIndex);
  const stages = stageIndex === -1 ? [] : lines.slice(stageIndex + 1);
  const markdown = [`# ${outcome}`, ""];
  for (const detail of details) {
    const match = detail.match(/^([^:]+):(.*)$/);
    markdown.push(match ? `- **${match[1]}:**${match[2]}` : `- ${detail}`);
  }
  if (stages.length > 0) markdown.push("", "## Stages", "", ...stages);
  if (assistantSummary?.trim()) markdown.push("", "## Assistant summary", "", assistantSummary.trimEnd());
  return markdown.join("\n");
}

function assistantText(message) {
  const text = Array.isArray(message.content)
    ? message.content.filter((part) => part?.type === "text").map((part) => part.text).join("")
    : "";
  return safeMultiline(text);
}

function labelFor(state, stage) {
  return state.stages.get(stage)?.label ?? stage;
}

function elapsed(startedAt, finishedAt) {
  return startedAt === null || startedAt === undefined ? "" : `(${elapsedPlain(startedAt, finishedAt)})`;
}

function elapsedPlain(startedAt, finishedAt) {
  if (startedAt === null || startedAt === undefined) return "0.0s";
  const seconds = Math.max(0, finishedAt - startedAt) / 1_000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(0)}s`;
}
