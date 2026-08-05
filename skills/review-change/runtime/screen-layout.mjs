export function statusScreenLayout({ width, height, fullLog = false, stageCount = 9, summary = false }) {
  const terminalWidth = Math.max(1, width);
  const terminalHeight = Math.max(1, height);
  const fullLogRows = Number(fullLog);
  if (terminalWidth < 32 || terminalHeight < 12) {
    const compactHeader = terminalHeight < 5;
    const contextRows = Number(!compactHeader && terminalHeight >= 4);
    const worktreeRows = Number(!compactHeader && terminalHeight >= 5);
    const fullLogRowsVisible = Number(!compactHeader && terminalHeight >= 6 && fullLog);
    const activityRows = summary ? 0 : 1 + Number(terminalHeight >= 8);
    const fixedRows = 1 + contextRows + worktreeRows + fullLogRowsVisible + activityRows + 1;
    return { mode: "tiny", paneWidth: terminalWidth, contentCapacity: Math.max(0, terminalHeight - fixedRows) };
  }
  if (terminalWidth >= 88) {
    const leftWidth = Math.max(40, Math.min(58, Math.floor(terminalWidth * 0.52)));
    return {
      mode: "split",
      leftWidth,
      paneWidth: terminalWidth - leftWidth - 1,
      contentCapacity: Math.max(0, terminalHeight - 7 - fullLogRows),
    };
  }
  const stageRows = Math.min(stageCount, Math.max(1, terminalHeight - 12));
  return {
    mode: "stacked",
    paneWidth: terminalWidth,
    stageRows,
    contentCapacity: Math.max(0, terminalHeight - 10 - fullLogRows - stageRows),
  };
}
