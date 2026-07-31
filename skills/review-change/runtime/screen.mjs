import { sliceLogWindow } from "./log-window.mjs";
const ESCAPE = "\u001b";
const RESET = `${ESCAPE}[0m`;
const GRAPHEME_SEGMENTER = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;
const MAX_SUBSTAGE_WORDS = 6;
const STYLE = {
  bold: `${ESCAPE}[1m`,
  dim: `${ESCAPE}[2m`,
  inverse: `${ESCAPE}[7m`,
  red: `${ESCAPE}[31m`,
  green: `${ESCAPE}[32m`,
  yellow: `${ESCAPE}[33m`,
  blue: `${ESCAPE}[34m`,
  magenta: `${ESCAPE}[35m`,
  cyan: `${ESCAPE}[36m`,
};

export function renderStatusScreen({ state, stream, timestamp, view, stages, formatDuration, color = true }) {
  const width = Math.max(1, stream.columns ?? 100);
  const height = Math.max(1, stream.rows ?? 30);
  if (width < 32 || height < 12) {
    return renderTinyStatusScreen({ state, width, height, timestamp, view, formatDuration, color });
  }
  if (width >= 88) {
    return renderSplitStatusScreen({ state, width, height, timestamp, view, stages, formatDuration, color });
  }
  const lines = [
    headerLine(state, width, timestamp, formatDuration, color),
    contextLine(state, width, color),
    worktreeLine(state, width, color),
    paint(rule(width), [STYLE.dim], color),
    paint("PIPELINE · READ-ONLY", [STYLE.bold, STYLE.cyan], color),
  ];
  for (const definition of visibleStageDefinitions(stages, view.selectedStage, height)) {
    lines.push(renderStage(
      state.stages.get(definition.id), timestamp, width,
      definition.id === view.selectedStage, formatDuration, color,
    ));
  }
  lines.push(paint(rule(width), [STYLE.dim], color));
  const selected = state.stages.get(view.selectedStage ?? state.currentStage ?? "target");
  lines.push(paint(`LOG · ${(selected?.label ?? "Waiting").toUpperCase()}`, [STYLE.bold, STYLE.magenta], color));
  lines.push(paint(clip(`DESCRIPTION · ${selected?.description ?? "Waiting"}`, width), [STYLE.dim], color));
  const available = Math.max(1, height - lines.length - 3);
  const isSummary = selected?.id === "summary" && state.finalSummary.length > 0;
  const logLines = view.showHelp
    ? helpLines(color, width, state.finalSummary.length > 0)
    : isSummary
      ? renderSummary(state.finalSummary, width, color, state.finalSummaryRendered)
      : renderLogs(selected?.logs ?? [], state.startedAt, width, view.expanded, formatDuration, color);
  if (logLines.length === 0) logLines.push(paint("  waiting for activity…", [STYLE.dim], color));
  if (view.showHelp) {
    lines.push(...logLines.slice(0, available));
  } else if (isSummary) {
    const maximumOffset = Math.max(0, logLines.length - available);
    const summaryOffset = Math.min(view.summaryOffset ?? 0, maximumOffset);
    lines.push(...logLines.slice(summaryOffset, summaryOffset + available));
  } else {
    lines.push(...sliceLogWindow(logLines, available, view.logOffset));
  }
  while (lines.length < height - 2) lines.push("");
  lines.push(paint(rule(width), [STYLE.dim], color));
  const footer = state.finalSummary.length > 0
    ? "Ctrl-C exit · Ctrl-U/D scroll log · j/k navigate stages · Enter expand/collapse lines · f follow"
    : "Ctrl-C abort · j/k navigate stages · Ctrl-U/D scroll log · Enter expand/collapse lines · f follow · ? help";
  lines.push(paint(clip(footer, width), [STYLE.dim], color));
  return `${ESCAPE}[H${ESCAPE}[2J${lines.slice(0, height).join("\n")}`;
}
function renderTinyStatusScreen({ state, width, height, timestamp, view, formatDuration, color }) {
  const selected = state.stages.get(view.selectedStage ?? state.currentStage ?? "target");
  const finalSummary = state.finalSummary.length > 0 && view.selectedStage === "summary";
  const content = view.showHelp
    ? helpLines(color, width, state.finalSummary.length > 0)
    : finalSummary
      ? renderSummary(state.finalSummary, width, color, state.finalSummaryRendered)
      : renderLogs(selected?.logs ?? [], state.startedAt, width, false, formatDuration, color);
  const compactHeader = height < 5;
  const lines = [compactHeader
    ? worktreeLine(state, width, color)
    : headerLine(state, width, timestamp, formatDuration, color)];
  if (!compactHeader && height >= 4) lines.push(contextLine(state, width, color));
  if (!compactHeader && height >= 5) lines.push(worktreeLine(state, width, color));
  if (!finalSummary) {
    lines.push(renderStage(selected, timestamp, width, true, formatDuration, color));
    if (height >= 7) lines.push(paint(clip(selected?.description ?? "Waiting", width), [STYLE.dim], color));
  }
  const footer = finalSummary ? "Ctrl-C exit · Ctrl-U/D" : "Ctrl-C abort · j/k nav · Ctrl-U/D";
  const available = Math.max(0, height - lines.length - 1);
  if (view.showHelp) {
    lines.push(...content.slice(0, available));
  } else if (finalSummary) {
    const maximumOffset = Math.max(0, content.length - available);
    const summaryOffset = Math.min(view.summaryOffset ?? 0, maximumOffset);
    lines.push(...content.slice(summaryOffset, summaryOffset + available));
  } else {
    lines.push(...sliceLogWindow(content, available, view.logOffset));
  }
  while (lines.length < height - 1) lines.push("");
  if (height > 1) lines.push(paint(clip(footer, width), [STYLE.dim], color));
  return `${ESCAPE}[H${ESCAPE}[2J${lines.slice(0, height).join("\n")}`;
}
function renderSplitStatusScreen({ state, width, height, timestamp, view, stages, formatDuration, color }) {
  const leftWidth = Math.max(40, Math.min(58, Math.floor(width * 0.52)));
  const rightWidth = width - leftWidth - 1;
  const bodyHeight = height - 6;
  const contentHeight = bodyHeight - 1;
  const selected = state.stages.get(view.selectedStage ?? state.currentStage ?? "target");
  const pipeline = cropPipelineLines(
    pipelineDetailLines(state, stages, view.selectedStage, timestamp, formatDuration, leftWidth),
    contentHeight,
  );
  const isSummary = selected?.id === "summary" && state.finalSummary.length > 0;
  const logs = view.showHelp
    ? helpLines(color, rightWidth, state.finalSummary.length > 0)
    : isSummary
      ? renderSummary(state.finalSummary, rightWidth, color, state.finalSummaryRendered)
      : renderLogs(selected?.logs ?? [], state.startedAt, rightWidth, view.expanded, formatDuration, color);
  if (logs.length === 0) logs.push(paint("  waiting for activity…", [STYLE.dim], color));
  const visibleLogs = view.showHelp
    ? logs.slice(0, contentHeight)
    : isSummary
      ? logs.slice(view.summaryOffset, view.summaryOffset + contentHeight)
      : sliceLogWindow(logs, contentHeight, view.logOffset);
  const divider = paint("│", [STYLE.dim], color);
  const body = [
    `${paint(fitCell("PIPELINE · READ-ONLY", leftWidth), [STYLE.bold, STYLE.cyan], color)}${divider}${paint(fitCell(`LOG · ${(selected?.label ?? "Waiting").toUpperCase()}`, rightWidth), [STYLE.bold, STYLE.magenta], color)}`,
  ];
  for (let index = 0; index < contentHeight; index += 1) {
    const pipelineLine = pipeline[index] ?? { text: "", styles: [] };
    const left = paint(fitCell(pipelineLine.text, leftWidth), pipelineLine.styles, color);
    const right = visibleLogs[index] ?? "";
    body.push(`${left}${divider}${right}`);
  }
  const footer = state.finalSummary.length > 0
    ? "Ctrl-C exit · Ctrl-U/D scroll log · j/k navigate stages · Enter expand/collapse lines · f follow"
    : "Ctrl-C abort · j/k navigate stages · Ctrl-U/D scroll log · Enter expand/collapse lines · f follow · ? help";
  const lines = [
    headerLine(state, width, timestamp, formatDuration, color),
    contextLine(state, width, color),
    worktreeLine(state, width, color),
    paint(rule(width), [STYLE.dim], color),
    ...body,
    paint(rule(width), [STYLE.dim], color),
    paint(clip(footer, width), [STYLE.dim], color),
  ];
  return `${ESCAPE}[H${ESCAPE}[2J${lines.slice(0, height).join("\n")}`;
}

function pipelineDetailLines(state, stages, selectedStage, timestamp, formatDuration, width) {
  const lines = [];
  for (const definition of stages) {
    const stage = state.stages.get(definition.id);
    const selected = definition.id === selectedStage;
    const marks = { pending: "○", running: "●", passed: "✓", failed: "×", waiting: "Ⅱ" };
    const stageColor = {
      pending: STYLE.dim,
      running: STYLE.cyan,
      passed: STYLE.green,
      failed: STYLE.red,
      waiting: STYLE.yellow,
    }[stage.status];
    const duration = stage.startedAt === undefined ? "" : ` · ${formatDuration(stage.startedAt, stage.finishedAt ?? timestamp)}`;
    lines.push({
      text: `${selected ? ">" : " "} ${marks[stage.status]} ${stage.label}${duration}`,
      styles: selected ? [STYLE.bold, STYLE.inverse, stageColor] : [stageColor],
      selected,
    });
    lines.push({ text: `    ${stage.description}`, styles: [STYLE.dim], selected });
    const steps = stage.logs.filter(({ kind }) => kind === "step");
    let currentStep = -1;
    for (const log of stage.logs) {
      if (log.kind === "step") {
        currentStep += 1;
        const active = new Set(["running", "waiting"]).has(stage.status) && currentStep === steps.length - 1;
        const stepFinishedAt = steps[currentStep + 1]?.timestamp ?? stage.finishedAt ?? timestamp;
        const stepDuration = formatDuration(log.timestamp, stepFinishedAt);
        lines.push({
          text: `    ${active ? "›" : "✓"} ${timedSubstage(log.message, stepDuration, width)}`,
          styles: [active ? STYLE.yellow : STYLE.green],
          selected,
        });
      } else if (log.kind === "log" && currentStep >= 0) {
        lines.push({ text: `      • ${conciseSubstage(log.message)}`, styles: [STYLE.cyan], selected });
      }
    }
    if (steps.length === 0 && stage.status === "running") {
      lines.push({ text: `    › ${conciseSubstage(stage.substage || "in progress")}`, styles: [STYLE.yellow], selected });
    } else if (stage.detail && (new Set(["failed", "waiting"]).has(stage.status)
      || stage.status === "passed" && steps.length === 0)) {
      lines.push({ text: `    ${stage.status === "failed" ? "×" : "↳"} ${stage.detail}`, styles: [stageColor], selected });
    }
  }
  return lines;
}

function cropPipelineLines(lines, available) {
  if (lines.length <= available) return lines;
  const firstSelected = Math.max(0, lines.findIndex(({ selected }) => selected));
  const lastSelected = Math.max(firstSelected, lines.findLastIndex(({ selected }) => selected));
  const before = lines.slice(0, firstSelected);
  const selected = lines.slice(firstSelected, lastSelected + 1);
  const after = lines.slice(lastSelected + 1);
  const markerCount = Number(before.length > 0) + Number(after.length > 0);
  const contentCapacity = Math.max(1, available - markerCount);
  const selectedVisible = selected.length <= contentCapacity
    ? selected
    : [...selected.slice(0, Math.min(2, contentCapacity)), ...selected.slice(-(Math.max(0, contentCapacity - 2)))];
  const contextCapacity = Math.max(0, contentCapacity - selectedVisible.length);
  const beforeCount = Math.min(before.length, Math.floor(contextCapacity / 2));
  const afterCount = Math.min(after.length, contextCapacity - beforeCount);
  const visible = [];
  if (before.length > 0) visible.push({ text: "  … earlier pipeline stages", styles: [STYLE.dim] });
  visible.push(...before.slice(-beforeCount), ...selectedVisible, ...after.slice(0, afterCount));
  if (after.length > 0) visible.push({ text: "  … later pipeline stages", styles: [STYLE.dim] });
  return visible.slice(0, available);
}

function fitCell(value, width) {
  const clipped = clip(value, width);
  return `${clipped}${" ".repeat(Math.max(0, width - terminalDisplayWidth(clipped)))}`;
}

function contextLine(state, width, color) {
  const scope = state.context.scope || state.context.target || "resolving";
  const line = clip(`SCOPE ${scope} · RISK ${state.risk.toUpperCase()} · OPEN FINDINGS ${state.findingCount}`, width);
  const riskColor = { low: STYLE.green, medium: STYLE.yellow, high: STYLE.red }[state.risk] ?? STYLE.dim;
  return paint(line, [riskColor], color);
}

function worktreeLine(state, width, color) {
  const workspace = state.context.workspace || "preparing isolated workspace";
  return paint(clip(`WORKTREE ${workspace}`, width), [STYLE.dim], color);
}

function headerLine(state, width, timestamp, formatDuration, color) {
  const status = state.exitCode === null ? "RUNNING" : state.exitCode === 0 ? "COMPLETE" : "FAILED";
  const duration = formatDuration(state.startedAt, state.finishedAt ?? timestamp);
  const line = clip(`REVIEW CHANGE${" ".repeat(Math.max(1, width - 27 - duration.length))}${status}  ${duration}`, width);
  const statusColor = state.exitCode === null ? STYLE.cyan : state.exitCode === 0 ? STYLE.green : STYLE.red;
  return paint(line, [STYLE.bold, statusColor], color);
}

function renderStage(stage, timestamp, width, selected, formatDuration, color) {
  const marks = { pending: "○", running: "●", passed: "✓", failed: "×", waiting: "Ⅱ" };
  const duration = stage.startedAt === undefined ? "" : formatDuration(stage.startedAt, stage.finishedAt ?? timestamp);
  const detail = stage.detail || (stage.status === "running"
    ? conciseSubstage(stage.substage || "in progress")
    : stage.status);
  const line = width < 64
    ? clip(`${selected ? ">" : " "} ${marks[stage.status]} ${stage.label} · ${detail}`, width)
    : clip(`${selected ? ">" : " "} ${marks[stage.status]} ${stage.label.padEnd(22)} ${duration.padStart(7)}  ${detail}`, width);
  const stageColor = {
    pending: STYLE.dim,
    running: STYLE.cyan,
    passed: STYLE.green,
    failed: STYLE.red,
    waiting: STYLE.yellow,
  }[stage.status];
  const styles = selected ? [STYLE.bold, STYLE.inverse, stageColor] : [stageColor];
  return paint(line, styles, color);
}

function renderLogs(logs, runStartedAt, width, expanded, formatDuration, color) {
  return logs.flatMap((log) => {
    const relative = formatDuration(runStartedAt, log.timestamp).padStart(7);
    const prefix = `${relative}  ${log.kind.toUpperCase().padEnd(9)} `;
    const logColor = colorForLog(log.kind);
    if (!expanded) return [paint(clip(`${prefix}${log.message}`, width), [logColor], color)];
    const wrapped = wrapLine(log.message, Math.max(20, width - prefix.length));
    return wrapped.map((line, index) => paint(
      clip(`${index === 0 ? prefix : " ".repeat(prefix.length)}${line}`, width),
      [logColor],
      color,
    ));
  });
}

function visibleStageDefinitions(stages, selectedStage, height) {
  const maximumRows = Math.max(1, height - 12);
  if (stages.length <= maximumRows) return stages;
  const selectedIndex = Math.max(0, stages.findIndex(({ id }) => id === selectedStage));
  const start = Math.max(0, Math.min(stages.length - maximumRows, selectedIndex - Math.floor(maximumRows / 2)));
  return stages.slice(start, start + maximumRows);
}

function renderSummary(summaryLines, width, color, preRendered = false) {
  if (preRendered) return summaryLines;
  return summaryLines.flatMap((line, index) => {
    const wrapped = wrapLine(line, width);
    const styles = index === 0
      ? [STYLE.bold, line.includes("completed") ? STYLE.green : STYLE.red]
      : line.startsWith("Report:")
        ? [STYLE.cyan]
        : line === "Stages:" || line === "Assistant summary:"
          ? [STYLE.bold, STYLE.magenta]
          : [STYLE.blue];
    return wrapped.map((part) => paint(part, styles, color));
  });
}
function conciseSubstage(message) {
  const words = String(message).trim().split(/\s+/).filter(Boolean);
  if (words.length <= MAX_SUBSTAGE_WORDS) return words.join(" ");
  return `${words.slice(0, MAX_SUBSTAGE_WORDS).join(" ")}…`;
}

function timedSubstage(message, duration, width) {
  const suffix = ` · ${duration}`;
  const labelWidth = Math.max(1, width - 6 - terminalDisplayWidth(suffix));
  return `${clip(conciseSubstage(message), labelWidth)}${suffix}`;
}

function colorForLog(kind) {
  if (kind === "error" || kind === "stderr") return STYLE.red;
  if (kind === "result") return STYLE.green;
  if (kind === "step") return STYLE.yellow;
  if (kind === "status") return STYLE.cyan;
  if (kind === "process") return STYLE.magenta;
  return STYLE.blue;
}

function helpLines(color, width = 100, finalView = false) {
  return [
    "  j / k    Select the next or previous stage",
    "  Ctrl-D/U Scroll down or up in the log",
    "  Enter    Expand or collapse log lines",
    "  f        Follow the currently active stage",
    "  ?        Close this help",
    finalView
      ? "  Ctrl-C   Exit the completed review"
      : "  Ctrl-C   Abort the child review process safely",
  ].map((line) => paint(clip(line, width), [STYLE.yellow], color));
}

function paint(value, styles, color) {
  if (!color) return value;
  return `${styles.join("")}${value}${RESET}`;
}

function wrapLine(value, width) {
  const lines = [];
  let line = "";
  let cells = 0;
  for (const grapheme of graphemes(value)) {
    const graphemeWidth = terminalDisplayWidth(grapheme);
    if (cells > 0 && cells + graphemeWidth > width) {
      lines.push(line);
      line = "";
      cells = 0;
    }
    line += grapheme;
    cells += graphemeWidth;
  }
  if (line || lines.length === 0) lines.push(line);
  return lines;
}

function clip(value, width) {
  if (terminalDisplayWidth(value) <= width) return value;
  if (width <= 0) return "";
  const limit = Math.max(0, width - 1);
  let clipped = "";
  let cells = 0;
  for (const grapheme of graphemes(value)) {
    const graphemeWidth = terminalDisplayWidth(grapheme);
    if (cells + graphemeWidth > limit) break;
    clipped += grapheme;
    cells += graphemeWidth;
  }
  return `${clipped}…`;
}

export function terminalDisplayWidth(value) {
  let width = 0;
  for (const grapheme of graphemes(value)) {
    if (/^\p{Mark}+$/u.test(grapheme)) continue;
    const codePoint = grapheme.codePointAt(0) ?? 0;
    const wide = /\p{Extended_Pictographic}/u.test(grapheme)
      || codePoint >= 0x1100 && (
        codePoint <= 0x115f
        || codePoint >= 0x2e80 && codePoint <= 0xa4cf
        || codePoint >= 0xac00 && codePoint <= 0xd7a3
        || codePoint >= 0xf900 && codePoint <= 0xfaff
        || codePoint >= 0xfe10 && codePoint <= 0xfe6f
        || codePoint >= 0xff00 && codePoint <= 0xff60
        || codePoint >= 0xffe0 && codePoint <= 0xffe6
      );
    width += wide ? 2 : 1;
  }
  return width;
}

function graphemes(value) {
  if (!GRAPHEME_SEGMENTER) return Array.from(String(value));
  return Array.from(GRAPHEME_SEGMENTER.segment(String(value)), ({ segment }) => segment);
}
function rule(width) {
  return "─".repeat(width);
}
