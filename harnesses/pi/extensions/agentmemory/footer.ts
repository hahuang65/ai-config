import path from "node:path";

import { ANSI_ESCAPE, stringWidth, visibleWidth } from "../../../../shared/string-width.ts";

type FooterTheme = {
  fg: (color: string, text: string) => string;
};

type FooterSnapshot = {
  location: string;
  coloredLocation?: string;
  memoryStatus: string;
  stats: string;
  model: string;
};

function formatTokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

const graphemeSegmenter = new Intl.Segmenter();

function truncatePlain(value: string, width: number): string {
  if (stringWidth(value) <= width) return value;
  if (width <= 1) return width === 1 ? "…" : "";
  let result = "";
  for (const { segment } of graphemeSegmenter.segment(value)) {
    if (stringWidth(result + segment) > width - 1) break;
    result += segment;
  }
  return `${result}…`;
}

function fitSides(
  left: string,
  coloredLeft: string,
  right: string,
  width: number,
  fallbackColor: (text: string) => string,
): string {
  const rightWidth = visibleWidth(right);
  if (rightWidth >= width) return truncatePlain(right.replace(ANSI_ESCAPE, ""), width);
  const fittedLeft = truncatePlain(left, Math.max(0, width - rightWidth - 1));
  const displayedLeft = fittedLeft === left ? coloredLeft : fallbackColor(fittedLeft);
  const padding = " ".repeat(Math.max(1, width - stringWidth(fittedLeft) - rightWidth));
  return displayedLeft + padding + right;
}

export function renderAgentMemoryFooter(
  snapshot: FooterSnapshot,
  theme: FooterTheme,
  width: number,
): string[] {
  const dim = (text: string) => theme.fg("dim", text);
  const first = fitSides(
    snapshot.location,
    snapshot.coloredLocation ?? theme.fg("warning", snapshot.location),
    snapshot.memoryStatus,
    width,
    (text) => theme.fg("warning", text),
  );
  const second = fitSides(snapshot.stats, dim(snapshot.stats), dim(snapshot.model), width, dim);
  return [first, second];
}

function usageStats(context: any): string {
  const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let latestCacheHitRate: number | undefined;
  for (const entry of context.sessionManager.getBranch()) {
    const usage = entry.type === "message" ? entry.message?.usage : entry.usage;
    if (!usage) continue;
    totals.input += usage.input ?? 0;
    totals.output += usage.output ?? 0;
    totals.cacheRead += usage.cacheRead ?? 0;
    totals.cacheWrite += usage.cacheWrite ?? 0;
    totals.cost += usage.cost?.total ?? 0;
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const promptTokens = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
      latestCacheHitRate = promptTokens > 0 ? ((usage.cacheRead ?? 0) / promptTokens) * 100 : undefined;
    }
  }
  const parts: string[] = [];
  if (totals.input) parts.push(`↑${formatTokens(totals.input)}`);
  if (totals.output) parts.push(`↓${formatTokens(totals.output)}`);
  if (totals.cacheRead) parts.push(`📚${formatTokens(totals.cacheRead)}`);
  if (totals.cacheWrite) parts.push(`💾${formatTokens(totals.cacheWrite)}`);
  if (latestCacheHitRate !== undefined) parts.push(`🎯${latestCacheHitRate.toFixed(1)}%`);
  const subscription = context.model?.provider === "kimi-coding" ? " (sub)" : "";
  parts.push(`$${totals.cost.toFixed(3)}${subscription}`);
  const contextUsage = context.getContextUsage?.();
  const contextWindow = contextUsage?.contextWindow ?? context.model?.contextWindow ?? 0;
  const percent = contextUsage?.percent;
  const usage = percent === null || percent === undefined
    ? `?/${formatTokens(contextWindow)}`
    : `${percent.toFixed(1)}%/${formatTokens(contextWindow)}`;
  parts.push(`${usage} (auto)`);
  if (process.env.PI_EXPERIMENTAL === "1") parts.push("• xp");
  return parts.join(" ");
}

function location(context: any, branch: string | undefined, theme: FooterTheme) {
  const cwd = context.sessionManager.getCwd?.() ?? context.cwd ?? process.cwd();
  const home = process.env.HOME;
  const relative = home ? path.relative(home, cwd) : cwd;
  const displayCwd = home && relative && !relative.startsWith("..")
    ? `~${path.sep}${relative}`
    : relative === "" ? "~" : cwd;
  const sessionName = context.sessionManager.getSessionName?.();
  const nameText = sessionName ? ` • ${sessionName}` : "";
  const branchText = branch ? ` (${branch})` : "";
  const coloredBranch = branch ? ` (${theme.fg("accent", branch)})` : "";
  return {
    plain: `${displayCwd}${branchText}${nameText}`,
    colored: `${theme.fg("warning", displayCwd)}${coloredBranch}${theme.fg("dim", nameText)}`,
  };
}

function model(context: any): string {
  const modelName = context.model?.id ?? "no-model";
  if (!context.model?.reasoning) return modelName;
  return `${modelName} • ${context.thinkingLevel ?? "thinking off"}`;
}

export function installAgentMemoryFooter(context: any): void {
  if (!context.ui?.setFooter) return;
  context.ui.setFooter((tui: any, theme: FooterTheme, footerData: any) => {
    const unsubscribe = footerData.onBranchChange?.(() => tui.requestRender());
    return {
      dispose: () => unsubscribe?.(),
      invalidate() {},
      render(width: number): string[] {
        const statuses = footerData.getExtensionStatuses() as Map<string, string>;
        const memoryStatus = statuses.get("agentmemory") ?? "";
        const currentLocation = location(context, footerData.getGitBranch(), theme);
        return renderAgentMemoryFooter({
          location: currentLocation.plain,
          coloredLocation: currentLocation.colored,
          memoryStatus,
          stats: usageStats(context),
          model: model(context),
        }, theme, width);
      },
    };
  });
}
