import { sliceLogWindow } from "./log-window.mjs";
import {
  renderedLogLineCount,
  renderedLogLines,
  renderedSummaryLineCount,
  renderedSummaryLines,
} from "./screen-content.mjs";
import { statusScreenLayout } from "./screen-layout.mjs";
import { graphemes, terminalDisplayWidth } from "./terminal-width.mjs";

export { renderedLogLineCount, renderedSummaryLineCount, statusScreenLayout };

const ESCAPE = "\u001b";
const RESET = `${ESCAPE}[0m`;
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
const STAGE_MARK = { pending: "○", running: "●", passed: "✓", failed: "×", waiting: "Ⅱ" };
const STAGE_STYLE = {
  pending: STYLE.dim,
  running: STYLE.cyan,
  passed: STYLE.green,
  failed: STYLE.red,
  waiting: STYLE.yellow,
};

export function renderStatusScreen({ state, stream, timestamp, view, stages, formatDuration, color = true }) {
  const width = Math.max(1, stream.columns ?? 100);
  const height = Math.max(1, stream.rows ?? 30);
  const selected = state.stages.get(view.selectedStage ?? state.currentStage ?? "target");
  const summary = selected?.id === "summary" && state.finalSummary.length > 0;
  const layout = statusScreenLayout({
    width, height, fullLog: Boolean(state.context.fullLog), stageCount: stages.length, summary,
  });
  if (layout.mode === "tiny") {
    return renderTinyStatusScreen({ state, width, height, timestamp, view, formatDuration, color, layout });
  }
  if (layout.mode === "split") {
    return renderSplitStatusScreen({ state, width, height, timestamp, view, stages, formatDuration, color, layout });
  }
  const lines = [
    headerLine(state, width, timestamp, formatDuration, color),
    contextLine(state, width, color),
    worktreeLine(state, width, color),
    ...(state.context.fullLog ? [fullLogLine(state, width, color)] : []),
    paint(rule(width), [STYLE.dim], color),
    paint("PIPELINE · READ-ONLY", [STYLE.bold, STYLE.cyan], color),
  ];
  for (const definition of visibleStageDefinitions(stages, view.selectedStage, layout.stageRows)) {
    lines.push(renderStage(
      state.stages.get(definition.id), timestamp, width,
      definition.id === view.selectedStage, formatDuration, color,
    ));
  }
  lines.push(paint(rule(width), [STYLE.dim], color));
  lines.push(paint(logHeading(selected), [STYLE.bold, STYLE.magenta], color));
  lines.push(paint(clip(`DESCRIPTION · ${selected?.description ?? "Waiting"}`, width), [STYLE.dim], color));
  const available = layout.contentCapacity;
  const logLines = view.showHelp
    ? helpLines(color, width, state.finalSummary.length > 0)
    : summary
      ? renderSummary(state.finalSummary, width, color, state.finalSummaryRendered)
      : renderLogs(selected, state.startedAt, width, view.expanded, formatDuration, color);
  if (logLines.length === 0) logLines.push(paint("  waiting for activity…", [STYLE.dim], color));
  if (view.showHelp) {
    lines.push(...logLines.slice(0, available));
  } else if (summary) {
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
function renderTinyStatusScreen({ state, width, height, timestamp, view, formatDuration, color, layout }) {
  const selected = state.stages.get(view.selectedStage ?? state.currentStage ?? "target");
  const finalSummary = state.finalSummary.length > 0 && view.selectedStage === "summary";
  const content = view.showHelp
    ? helpLines(color, width, state.finalSummary.length > 0)
    : finalSummary
      ? renderSummary(state.finalSummary, width, color, state.finalSummaryRendered)
      : renderLogs(selected, state.startedAt, width, view.expanded, formatDuration, color);
  const compactHeader = height < 5;
  const lines = [compactHeader
    ? worktreeLine(state, width, color)
    : headerLine(state, width, timestamp, formatDuration, color)];
  if (!compactHeader && height >= 4) lines.push(contextLine(state, width, color));
  if (!compactHeader && height >= 5) lines.push(worktreeLine(state, width, color));
  if (!compactHeader && height >= 6 && state.context.fullLog) {
    lines.push(fullLogLine(state, width, color));
  }
  if (!finalSummary) {
    lines.push(renderStage(selected, timestamp, width, true, formatDuration, color, { compactOmission: true }));
    if (height >= 8) lines.push(paint(clip(selected?.description ?? "Waiting", width), [STYLE.dim], color));
  }
  const footer = finalSummary ? "Ctrl-C exit · Ctrl-U/D" : "Ctrl-C abort · j/k nav · Ctrl-U/D";
  const available = layout.contentCapacity;
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
function renderSplitStatusScreen({ state, width, height, timestamp, view, stages, formatDuration, color, layout }) {
  const leftWidth = layout.leftWidth;
  const rightWidth = layout.paneWidth;
  const contentHeight = layout.contentCapacity;
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
      : renderLogs(selected, state.startedAt, rightWidth, view.expanded, formatDuration, color);
  if (logs.length === 0) logs.push(paint("  waiting for activity…", [STYLE.dim], color));
  const visibleLogs = view.showHelp
    ? logs.slice(0, contentHeight)
    : isSummary
      ? logs.slice(view.summaryOffset, view.summaryOffset + contentHeight)
      : sliceLogWindow(logs, contentHeight, view.logOffset);
  const divider = paint("│", [STYLE.dim], color);
  const body = [
    `${paint(fitCell("PIPELINE · READ-ONLY", leftWidth), [STYLE.bold, STYLE.cyan], color)}${divider}${paint(fitCell(logHeading(selected), rightWidth), [STYLE.bold, STYLE.magenta], color)}`,
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
    ...(state.context.fullLog ? [fullLogLine(state, width, color)] : []),
    paint(rule(width), [STYLE.dim], color),
    ...body,
    paint(rule(width), [STYLE.dim], color),
    paint(clip(footer, width), [STYLE.dim], color),
  ];
  return `${ESCAPE}[H${ESCAPE}[2J${lines.slice(0, height).join("\n")}`;
}

function logHeading(stage) {
  const count = stage?.omittedLogEntries ?? 0;
  const omitted = count > 0 ? ` · ${count} ENTRIES OMITTED` : "";
  return `LOG · ${(stage?.label ?? "Waiting").toUpperCase()}${omitted}`;
}

function pipelineDetailLines(state, stages, selectedStage, timestamp, formatDuration, width) {
  const lines = [];
  for (const definition of stages) {
    const stage = state.stages.get(definition.id);
    const selected = definition.id === selectedStage;
    const stageColor = STAGE_STYLE[stage.status];
    const duration = stage.startedAt === undefined ? "" : ` · ${formatDuration(stage.startedAt, stage.finishedAt ?? timestamp)}`;
    lines.push({
      text: `${selected ? ">" : " "} ${STAGE_MARK[stage.status]} ${stage.label}${duration}`,
      styles: selected ? [STYLE.bold, STYLE.inverse, stageColor] : [stageColor],
      selected,
    });
    lines.push({ text: `    ${stage.description}`, styles: [STYLE.dim], selected });
    const steps = stage.logs.filter(({ kind }) => kind === "step");
    let currentStep = -1;
    for (const log of stage.logs) {
      if (log.kind === "step") {
        currentStep += 1;
        const active = ["running", "waiting"].includes(stage.status) && currentStep === steps.length - 1;
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
    } else if (stage.detail && (["failed", "waiting"].includes(stage.status)
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

function fullLogLine(state, width, color) {
  return paint(clip(`FULL LOG ${state.context.fullLog}`, width), [STYLE.dim], color);
}

function headerLine(state, width, timestamp, formatDuration, color) {
  const status = state.exitCode === null ? "RUNNING" : state.exitCode === 0 ? "COMPLETE" : "FAILED";
  const duration = formatDuration(state.startedAt, state.finishedAt ?? timestamp);
  const line = clip(`REVIEW CHANGE${" ".repeat(Math.max(1, width - 27 - duration.length))}${status}  ${duration}`, width);
  const statusColor = state.exitCode === null ? STYLE.cyan : state.exitCode === 0 ? STYLE.green : STYLE.red;
  return paint(line, [STYLE.bold, statusColor], color);
}

function renderStage(stage, timestamp, width, selected, formatDuration, color, options = {}) {
  const duration = stage.startedAt === undefined ? "" : formatDuration(stage.startedAt, stage.finishedAt ?? timestamp);
  const detail = stage.detail || (stage.status === "running"
    ? conciseSubstage(stage.substage || "in progress")
    : stage.status);
  const omitted = options.compactOmission && stage.omittedLogEntries > 0
    ? `${stage.omittedLogEntries} OMIT · `
    : "";
  const line = width < 64
    ? clip(`${selected ? ">" : " "} ${STAGE_MARK[stage.status]} ${omitted}${stage.label} · ${detail}`, width)
    : clip(`${selected ? ">" : " "} ${STAGE_MARK[stage.status]} ${stage.label.padEnd(22)} ${duration.padStart(7)}  ${detail}`, width);
  const stageColor = STAGE_STYLE[stage.status];
  const styles = selected ? [STYLE.bold, STYLE.inverse, stageColor] : [stageColor];
  return paint(line, styles, color);
}

function renderLogs(stage, runStartedAt, width, expanded, formatDuration, color) {
  return renderedLogLines(stage, runStartedAt, width, expanded, formatDuration).map(({ text, kind }) => (
    paint(clip(text, width), [colorForLog(kind)], color)
  ));
}

function visibleStageDefinitions(stages, selectedStage, maximumRows) {
  if (stages.length <= maximumRows) return stages;
  const selectedIndex = Math.max(0, stages.findIndex(({ id }) => id === selectedStage));
  const start = Math.max(0, Math.min(stages.length - maximumRows, selectedIndex - Math.floor(maximumRows / 2)));
  return stages.slice(start, start + maximumRows);
}

function renderSummary(summaryLines, width, color, preRendered = false) {
  return renderedSummaryLines(summaryLines, width, preRendered).map((line) => {
    if (line.preRendered) return line.text;
    const styles = line.sourceIndex === 0
      ? [STYLE.bold, line.source.includes("completed") ? STYLE.green : STYLE.red]
      : line.source.startsWith("Report:")
        ? [STYLE.cyan]
        : line.source === "Stages:" || line.source === "Assistant summary:"
          ? [STYLE.bold, STYLE.magenta]
          : [STYLE.blue];
    return paint(line.text, styles, color);
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

function rule(width) {
  return "─".repeat(width);
}
