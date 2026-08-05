import { renderMarkdownWithGlow } from "./markdown-summary.mjs";
import {
  renderedLogLineCount,
  renderedSummaryLineCount,
  renderStatusScreen,
  statusScreenLayout,
} from "./screen.mjs";
import {
  addLog,
  applyPiEvent,
  beginStage,
  createState,
  elapsed,
  elapsedPlain,
  finishStage,
  labelFor,
  STAGES,
  VALIDATION_STAGES,
} from "./status-state.mjs";
import { renderTerminalSummary } from "./summary.mjs";
import { createTelemetryLog } from "./telemetry-log.mjs";
import {
  sanitizeTelemetryLine,
  sanitizeTerminalLine as safeLine,
} from "./terminal-text.mjs";

const ESCAPE = "\u001b";
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
    this.createTelemetryLog = options.createTelemetryLog ?? createTelemetryLog;
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
    this.finalSetupPending = false;
    this.finalDismissRequested = false;
    this.dismissFinal = null;
    this.previousRawMode = false;
    this.summaryRenderGeneration = 0;
    this.summaryRenderAbort = null;
    this.handleInput = this.handleInput.bind(this);
    this.handleResize = this.handleResize.bind(this);
  }

  start(context = {}) {
    this.finalDismissRequested = false;
    this.state.startedAt = this.now();
    this.state.context = {
      target: safeLine(context.target ?? ""),
      intent: safeLine(context.intent ?? ""),
      workspace: "",
      fullLog: "",
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

  attachTelemetryLog(workspacePath) {
    const telemetryLog = this.createTelemetryLog(workspacePath, this.state.pendingTelemetry);
    this.state.telemetryLog = telemetryLog;
    this.state.telemetryDetached = false;
    this.state.pendingTelemetry = [];
    this.state.context.fullLog = sanitizeTelemetryLine(telemetryLog.path);
    this.redraw();
    return telemetryLog.path;
  }

  detachTelemetryLog() {
    const telemetryLog = this.state.telemetryLog;
    this.state.telemetryLog = null;
    this.state.telemetryDetached = true;
    telemetryLog?.close();
  }

  setLifecycleFailureHandler(handler) {
    this.state.lifecycleFailureHandler = handler;
    if (handler && this.state.lifecycleFailure) handler(this.state.lifecycleFailure);
  }

  throwIfFailed() {
    if (this.state.lifecycleFailure) throw this.state.lifecycleFailure;
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
      if (this.state.stages.get(stage)?.status !== "failed") {
        finishStage(this.state, stage, "failed", `pi exited with status ${exitCode}`, this.now());
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
    this.finalSetupPending = true;
    if (this.renderSummaryMarkdown) await this.refreshRenderedSummary();
    this.finalSetupPending = false;
    this.selectedStage = "summary";
    this.summaryOffset = 0;
    this.logOffset = 0;
    this.followActive = false;
    this.finalView = true;
    const canWait = this.input?.isTTY && typeof this.input.setRawMode === "function";
    if (!canWait || this.finalDismissRequested) {
      this.redraw();
      this.restoreTerminal();
      if (!canWait) {
        this.summaryStream.write(parentSummary);
        if (assistantSummary) this.summaryStream.write(assistantSummary);
      }
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
    this.finalDismissRequested = true;
    if (this.finalSetupPending) this.summaryRenderAbort?.abort();
    if (!this.finalView) return;
    const dismiss = this.dismissFinal;
    this.dismissFinal = null;
    dismiss?.();
  }

  emitLine(text) {
    if (!this.fullScreen) this.stream.write(`${safeLine(text)}\n`);
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
    return this.currentLayout(true).paneWidth;
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
    const layout = this.currentLayout(true);
    const lineCount = renderedSummaryLineCount(
      this.state.finalSummary,
      layout.paneWidth,
      this.state.finalSummaryRendered,
    );
    return Math.max(0, lineCount - layout.contentCapacity);
  }

  clampSummaryOffset() {
    this.summaryOffset = Math.max(0, Math.min(this.summaryOffset, this.maximumSummaryOffset()));
  }

  maximumLogOffset() {
    const selected = this.state.stages.get(this.selectedStage ?? this.state.currentStage ?? "target");
    if (!selected || selected.logs.length === 0) return 0;
    const layout = this.currentLayout(false);
    const lineCount = renderedLogLineCount(
      selected,
      this.state.startedAt,
      layout.paneWidth,
      this.expanded,
      elapsedPlain,
    );
    return Math.max(0, lineCount - layout.contentCapacity);
  }

  currentLayout(summary) {
    return statusScreenLayout({
      width: Math.max(1, this.stream.columns ?? 100),
      height: Math.max(1, this.stream.rows ?? 30),
      fullLog: Boolean(this.state.context.fullLog),
      stageCount: STAGES.length,
      summary,
    });
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
    this.fullScreen = false;
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
    if (this.finalView && ["q", "x", "\u001b"].includes(key)) return;
    const viewingSummary = this.finalView && this.selectedStage === "summary";
    if (viewingSummary && ["\u0015", "\u001b[5~"].includes(key)) {
      this.clampSummaryOffset();
      this.summaryOffset = Math.max(0, this.summaryOffset - SCROLL_LINES);
    } else if (viewingSummary && ["\u0004", "\u001b[6~"].includes(key)) {
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
