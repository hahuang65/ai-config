import { graphemes, terminalDisplayWidth } from "./terminal-width.mjs";

export function renderedLogLineCount(stage, runStartedAt, width, expanded, formatDuration) {
  return renderedLogLines(stage, runStartedAt, width, expanded, formatDuration).length;
}

export function renderedLogLines(stage, runStartedAt, width, expanded, formatDuration) {
  return (stage?.logs ?? []).flatMap((log) => {
    const relative = formatDuration(runStartedAt, log.timestamp).padStart(7);
    const prefix = `${relative}  ${log.kind.toUpperCase().padEnd(9)} `;
    const omission = log.omittedCharacters > 0 ? `[${log.omittedCharacters} characters omitted] ` : "";
    const message = `${omission}${log.message}`;
    if (!expanded) return [{ text: `${prefix}${message}`, kind: log.kind }];
    const messageWidth = Math.max(1, width - terminalDisplayWidth(prefix));
    return wrapLine(message, messageWidth).map((line, index) => ({
      text: `${index === 0 ? prefix : " ".repeat(terminalDisplayWidth(prefix))}${line}`,
      kind: log.kind,
    }));
  });
}

export function renderedSummaryLineCount(summaryLines, width, preRendered = false) {
  return renderedSummaryLines(summaryLines, width, preRendered).length;
}

export function renderedSummaryLines(summaryLines, width, preRendered = false) {
  if (preRendered) return summaryLines.map((text) => ({ text, preRendered: true }));
  return summaryLines.flatMap((source, sourceIndex) => (
    wrapLine(source, width).map((text) => ({ text, source, sourceIndex, preRendered: false }))
  ));
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
