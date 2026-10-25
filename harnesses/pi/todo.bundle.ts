// harnesses/pi/checklist/state.ts
import { Type } from "typebox";
var entryType = "ai-config.session-checklist";

class InvalidChecklistState extends Error {
}
var item = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" }),
  text: Type.String({ minLength: 1, maxLength: 240, pattern: "\\S" }),
  status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")])
}, { additionalProperties: false });
var snapshot = Type.Object({
  version: Type.Literal(1),
  title: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
  items: Type.Array(item, { maxItems: 24 })
}, { additionalProperties: false });
var parameters = Type.Object({
  action: Type.Union([Type.Literal("read"), Type.Literal("write")]),
  title: Type.Optional(snapshot.properties.title),
  items: Type.Optional(snapshot.properties.items)
}, { additionalProperties: false });
var output = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("error"), Type.Literal("cancelled")]),
  checklist: snapshot,
  error: Type.Optional(Type.String())
}, { additionalProperties: false });
var empty = () => ({ version: 1, title: "Current task", items: [] });
var copy = (value) => ({ ...value, items: value.items.map((item2) => ({ ...item2 })) });
var text = (value, limit) => typeof value === "string" && value.length > 0 && value.length <= limit && /\S/u.test(value);
var keys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
function validItem(value) {
  if (!value || typeof value !== "object")
    return false;
  const item2 = value;
  return keys(item2, ["id", "text", "status"]) && text(item2.id, 40) && /^[A-Za-z0-9]/u.test(item2.id) && !/[^A-Za-z0-9_-]/u.test(item2.id) && text(item2.text, 240) && ["pending", "in_progress", "completed"].includes(item2.status);
}
function valid(value) {
  if (!value || typeof value !== "object")
    return false;
  const data = value;
  return keys(data, ["version", "title", "items"]) && data.version === 1 && text(data.title, 160) && Array.isArray(data.items) && data.items.length <= 24 && data.items.every(validItem) && new Set(data.items.map((item2) => item2.id)).size === data.items.length && data.items.filter((item2) => item2.status === "in_progress").length <= 1;
}
function read(ctx) {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1;index >= 0; index--) {
    const entry = branch[index];
    if (entry.type !== "custom" || entry.customType !== entryType)
      continue;
    if (!valid(entry.data))
      throw new InvalidChecklistState("Invalid stored checklist");
    return copy(entry.data);
  }
  return empty();
}
function reply(checklist, status = "ok", error) {
  const value = { status, checklist: copy(checklist), ...error ? { error } : {} };
  const text2 = JSON.stringify(value).replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return {
    content: [{ type: "text", text: text2 }],
    details: value,
    structuredContent: value,
    ...status === "error" ? { isError: true } : {}
  };
}

// harnesses/pi/checklist/view.ts
import { stripTerminalSequences, Text, truncateToWidth } from "@earendil-works/pi-tui";
var key = "ai-config-session-checklist";
var safe = (text2) => stripTerminalSequences(text2).replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, " ");
var glyph = { pending: "○", in_progress: "◐", completed: "✓" };
var row = (item2) => `${glyph[item2.status]} ${safe(item2.text)}`;
var heading = (value) => `Steps ${value.items.filter((item2) => item2.status === "completed").length}/${value.items.length}: ${safe(value.title)}`;
function caption(args, theme) {
  const action = args && typeof args === "object" ? args.action : undefined;
  const label = action === "read" ? "read" : action === "write" ? "write" : "call";
  return new Text(theme.fg("toolTitle", `Session checklist: ${label}`), 0, 0);
}
function full(value) {
  return value.items.length ? [heading(value), ...value.items.map(row)].join(`
`) : "No session checklist.";
}
function compact(value) {
  const active = value.items.filter((item2) => item2.status === "in_progress");
  const pending = value.items.filter((item2) => item2.status === "pending");
  const completed = value.items.filter((item2) => item2.status === "completed");
  const shown = [...active, ...pending, ...completed].slice(0, 4);
  const lines = [heading(value), ...shown.map(row)];
  if (value.items.length > shown.length)
    lines.push(`+${value.items.length - shown.length} more — /todos`);
  return lines;
}
function show(ctx, value) {
  try {
    if (!ctx.hasUI)
      return;
    if (!value.items.length) {
      ctx.ui.setWidget(key, undefined);
      return;
    }
    if (ctx.mode !== "tui") {
      ctx.ui.setWidget(key, compact(value), { placement: "aboveEditor" });
      return;
    }
    ctx.ui.setWidget(key, (_tui, theme) => ({
      invalidate() {},
      render(width) {
        try {
          if (width <= 0)
            return [];
          return compact(value).map((line, index) => theme.fg(index ? "text" : "accent", truncateToWidth(line, width, "…")));
        } catch {
          return [];
        }
      }
    }), { placement: "aboveEditor" });
  } catch {}
}
function notify(ctx, render, level) {
  try {
    if (ctx.hasUI)
      ctx.ui.notify(render(), level);
  } catch {}
}
function clear(ctx) {
  try {
    if (ctx.hasUI)
      ctx.ui.setWidget(key, undefined);
  } catch {}
}

// harnesses/pi/todo.ts
function refresh(_event, ctx) {
  try {
    show(ctx, read(ctx));
  } catch {
    clear(ctx);
  }
}
function checklist(pi) {
  pi.registerTool({
    name: "todo",
    label: "Session checklist",
    exposure: "model-only",
    executionMode: "sequential",
    description: "Read or atomically replace the current task's short session checklist. " + "Use read to recover progress, or write with title and the complete items array. " + "Items have unique stable ids, short text, and pending/in_progress/completed status; at most one may be in progress. " + "Track meaningful steps only within the authorized task, not speculative tests or routine conversation. " + "This is not Worklog, a backlog, a scheduler, approval, or authority to implement, commit, install, deliver, or publish.",
    parameters,
    outputSchema: output,
    renderCall: caption,
    async execute(_id, input, signal, _update, ctx) {
      try {
        if (signal?.aborted)
          return reply(read(ctx), "cancelled");
        if (input.action === "read") {
          if (input.title !== undefined || input.items !== undefined) {
            return reply(read(ctx), "error", "Read does not accept title or items.");
          }
          return reply(read(ctx));
        }
        const next = { version: 1, title: input.title, items: input.items };
        if (!valid(next))
          return reply(read(ctx), "error", "A write requires a bounded title and items array, unique ids, and at most one in-progress step.");
        pi.appendEntry(entryType, copy(next));
        show(ctx, next);
        return reply(next);
      } catch {
        return reply(empty(), "error", "Unable to read or confirm checklist persistence. Read before retrying.");
      }
    }
  });
  pi.registerCommand("todos", {
    description: "Show the current session checklist without changing it",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI)
        return;
      try {
        const current = read(ctx);
        notify(ctx, () => full(current), "info");
      } catch (error) {
        const message = error instanceof InvalidChecklistState ? "The stored session checklist is invalid. Replace it explicitly to recover." : "The session checklist is unavailable. Try reading it again.";
        notify(ctx, () => message, "error");
      }
    }
  });
  pi.on("session_start", refresh);
  pi.on("session_tree", refresh);
  pi.on("session_compact", refresh);
  pi.on("session_shutdown", (_event, ctx) => clear(ctx));
}
export {
  checklist as default
};
