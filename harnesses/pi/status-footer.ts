// Service-independent version of the original two-line Pi footer.
import path from "node:path";
import { stripTerminalSequences, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Theme = { fg: (color: string, text: string) => string };
type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number;
  cost?: { total?: number } };
type BranchEntry = { type: string; usage?: Usage;
  message?: { role?: string; usage?: Usage } };
type Context = {
  mode: string; cwd: string; model?: { id: string; provider: string; reasoning?: boolean; contextWindow?: number };
  thinkingLevel?: string;
  getContextUsage?: () => { percent?: number | null; contextWindow?: number } | undefined;
  sessionManager: { getCwd?: () => string; getSessionName?: () => string | undefined;
    getBranch: () => BranchEntry[] };
  ui: { setFooter: (factory: (tui: { requestRender: () => void }, theme: Theme,
    data: { getGitBranch: () => string | undefined;
      onBranchChange?: (listener: () => void) => (() => void) | undefined }) => unknown) => void };
};

function safeText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ""))
    .slice(0, maximum).join("");
}

function number(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function width(value: string): number {
  return visibleWidth(value);
}

function truncate(value: string, maximum: number): string {
  return truncateToWidth(stripTerminalSequences(value), maximum, "…");
}

function fit(left: string, styledLeft: string, right: string, columns: number,
  fallback: (value: string) => string): string {
  if (columns <= 0) return "";
  if (width(right) >= columns) return truncate(right, columns);
  const fitted = truncate(left, Math.max(0, columns - width(right) - (right ? 1 : 0)));
  const colored = fitted === left ? styledLeft : fallback(fitted);
  const padding = right ? " ".repeat(Math.max(1, columns - width(fitted) - width(right))) : "";
  return colored + padding + right;
}

function tokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function stats(context: Context): string {
  const total = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
  let latestRate: number | undefined;
  for (const entry of context.sessionManager.getBranch()) {
    const usage = entry.type === "message" ? entry.message?.usage : entry.usage;
    if (!usage) continue;
    total.input += number(usage.input);
    total.output += number(usage.output);
    total.cacheRead += number(usage.cacheRead);
    total.cacheWrite += number(usage.cacheWrite);
    total.cost += number(usage.cost?.total);
    if (entry.type === "message" && entry.message?.role === "assistant") {
      const prompt = number(usage.input) + number(usage.cacheRead) + number(usage.cacheWrite);
      latestRate = prompt > 0 ? number(usage.cacheRead) / prompt * 100 : undefined;
    }
  }
  const parts: string[] = [];
  if (total.input) parts.push(`↑${tokens(total.input)}`);
  if (total.output) parts.push(`↓${tokens(total.output)}`);
  if (total.cacheRead) parts.push(`📚${tokens(total.cacheRead)}`);
  if (total.cacheWrite) parts.push(`💾${tokens(total.cacheWrite)}`);
  if (latestRate !== undefined) parts.push(`🎯${latestRate.toFixed(1)}%`);
  const subscription = context.model?.provider === "kimi-coding" ? " (sub)" : "";
  parts.push(`$${total.cost.toFixed(3)}${subscription}`);
  const contextUsage = context.getContextUsage?.();
  const window = number(contextUsage?.contextWindow ?? context.model?.contextWindow);
  const percent = contextUsage?.percent;
  parts.push(`${percent == null ? "?" : number(percent).toFixed(1) + "%"}/${tokens(window)} (auto)`);
  if (process.env.PI_EXPERIMENTAL === "1") parts.push("• xp");
  return parts.join(" ");
}

function location(context: Context, branch: string | undefined, theme: Theme) {
  const cwd = safeText(context.sessionManager.getCwd?.() ?? context.cwd, 1024);
  const home = process.env.HOME;
  const relative = home ? path.relative(home, cwd) : cwd;
  const directory = home && relative && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? `~${path.sep}${relative}` : relative === "" && home ? "~" : cwd;
  const name = safeText(context.sessionManager.getSessionName?.(), 100);
  const gitBranch = safeText(branch, 120);
  return {
    plain: `${directory}${gitBranch ? ` (${gitBranch})` : ""}${name ? ` • ${name}` : ""}`,
    styled: `${theme.fg("warning", directory)}${gitBranch ? ` (${theme.fg("accent", gitBranch)})` : ""}${name ? theme.fg("dim", ` • ${name}`) : ""}`,
  };
}

export default function statusFooter(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    const context = ctx as unknown as Context;
    context.ui.setFooter((tui, theme, data) => {
      const unsubscribe = data.onBranchChange?.(() => tui.requestRender());
      return {
        dispose: () => unsubscribe?.(),
        invalidate() {},
        render(columns: number): string[] {
          const current = location(context, data.getGitBranch(), theme);
          const dim = (value: string) => theme.fg("dim", value);
          const modelName = safeText(context.model?.id, 120) || "no-model";
          const model = context.model?.reasoning
            ? `${modelName} • ${safeText(context.thinkingLevel, 24) || "thinking off"}` : modelName;
          const usage = stats(context);
          return [
            fit(current.plain, current.styled, "", columns, (value) => theme.fg("warning", value)),
            fit(usage, dim(usage), dim(model), columns, dim),
          ];
        },
      };
    });
  });
}
