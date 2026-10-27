import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences, Text, truncateToWidth } from "@earendil-works/pi-tui";
import type { Snapshot } from "./state";

const key = "ai-config-session-checklist";
const safe = (text: string) => stripTerminalSequences(text)
  .replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, " ");
const glyph = { pending: "○", in_progress: "◐", completed: "✓" };
const row = (item: Snapshot["items"][number]) => `${glyph[item.status]} ${safe(item.text)}`;
const heading = (value: Snapshot) =>
  `Steps ${value.items.filter(item => item.status === "completed").length}/${value.items.length}: ${safe(value.title)}`;

export function caption(args: unknown, theme: Theme): Text {
  const action = args && typeof args === "object" ? (args as { action?: unknown }).action : undefined;
  const label = action === "read" ? "read" : action === "write" ? "write" : "call";
  return new Text(theme.fg("toolTitle", `Session checklist: ${label}`), 0, 0);
}

export function full(value: Snapshot): string {
  if (!value.items.some(item => item.status !== "completed")) return "No ongoing session checklist.";
  const active = value.items.filter(item => item.status === "in_progress");
  const pending = value.items.filter(item => item.status === "pending");
  const completed = value.items.filter(item => item.status === "completed");
  return [heading(value), "Active and upcoming", ...active.map(row), ...pending.map(row),
    ...(completed.length ? ["Completed", ...completed.map(row)] : [])].join("\n");
}

function compact(value: Snapshot): string[] {
  const active = value.items.filter(item => item.status === "in_progress");
  const pending = value.items.filter(item => item.status === "pending");
  const completed = value.items.filter(item => item.status === "completed");
  const ongoing = [...active, ...pending];
  const shown = ongoing.slice(0, completed.length ? 3 : 4);
  const lines = [heading(value), ...shown.map(row)];
  if (ongoing.length > shown.length) lines.push(`+${ongoing.length - shown.length} more — /todos`);
  if (completed.length) lines.push(`Completed: ${completed.length} — /todos`);
  return lines;
}

export function show(ctx: ExtensionContext, value: Snapshot): void {
  try {
    if (!ctx.hasUI) return;
    if (!value.items.some(item => item.status !== "completed")) { ctx.ui.setWidget(key, undefined); return; }
    if (ctx.mode !== "tui") { ctx.ui.setWidget(key, compact(value), { placement: "aboveEditor" }); return; }
    ctx.ui.setWidget(key, (_tui, theme: Theme) => ({
      invalidate() {},
      render(width: number) {
        try {
          if (width <= 0) return [];
          return compact(value).map((line, index) => theme.fg(index ? "text" : "accent", truncateToWidth(line, width, "…")));
        } catch { return []; }
      },
    }), { placement: "aboveEditor" });
  } catch { /* Presentation failure must not undo or misreport saved progress. */ }
}

export function notify(ctx: ExtensionContext, render: () => string, level: "info" | "error"): void {
  try { if (ctx.hasUI) ctx.ui.notify(render(), level); }
  catch { /* Presentation failure is not a stored-state failure. */ }
}

export function clear(ctx: ExtensionContext): void {
  try { if (ctx.hasUI) ctx.ui.setWidget(key, undefined); }
  catch { /* The host may already have disposed this UI. */ }
}
