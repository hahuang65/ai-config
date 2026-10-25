import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";

export const entryType = "ai-config.session-checklist";
export class InvalidChecklistState extends Error {}
const item = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 40, pattern: "^[A-Za-z0-9][A-Za-z0-9_-]*$" }),
  text: Type.String({ minLength: 1, maxLength: 240, pattern: "\\S" }),
  status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
}, { additionalProperties: false });
export const snapshot = Type.Object({ version: Type.Literal(1),
  title: Type.String({ minLength: 1, maxLength: 160, pattern: "\\S" }),
  items: Type.Array(item, { maxItems: 24 }),
}, { additionalProperties: false });
export type Snapshot = Static<typeof snapshot>;
export const parameters = Type.Object({ action: Type.Union([Type.Literal("read"), Type.Literal("write")]),
  title: Type.Optional(snapshot.properties.title), items: Type.Optional(snapshot.properties.items),
}, { additionalProperties: false });
export const output = Type.Object({
  status: Type.Union([Type.Literal("ok"), Type.Literal("error"), Type.Literal("cancelled")]),
  checklist: snapshot, error: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const empty = (): Snapshot => ({ version: 1, title: "Current task", items: [] });

export const copy = (value: Snapshot): Snapshot => ({ ...value, items: value.items.map(item => ({ ...item })) });
const text = (value: unknown, limit: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= limit && /\S/u.test(value);
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));

function validItem(value: unknown): value is Snapshot["items"][number] {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return keys(item, ["id", "text", "status"]) && text(item.id, 40) &&
    /^[A-Za-z0-9]/u.test(item.id) && !/[^A-Za-z0-9_-]/u.test(item.id) && text(item.text, 240) &&
    ["pending", "in_progress", "completed"].includes(item.status as string);
}

export function valid(value: unknown): value is Snapshot {
  if (!value || typeof value !== "object") return false;
  const data = value as Record<string, unknown>;
  return keys(data, ["version", "title", "items"]) && data.version === 1 && text(data.title, 160) &&
    Array.isArray(data.items) && data.items.length <= 24 && data.items.every(validItem) &&
    new Set(data.items.map(item => item.id)).size === data.items.length &&
    data.items.filter(item => item.status === "in_progress").length <= 1;
}

export function read(ctx: Pick<ExtensionContext, "sessionManager">): Snapshot {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const entry = branch[index];
    if (entry.type !== "custom" || entry.customType !== entryType) continue;
    if (!valid(entry.data)) throw new InvalidChecklistState("Invalid stored checklist");
    return copy(entry.data);
  }
  return empty();
}

export function reply(checklist: Snapshot, status: "ok" | "error" | "cancelled" = "ok", error?: string) {
  const value = { status, checklist: copy(checklist), ...(error ? { error } : {}) };
  const text = JSON.stringify(value).replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu,
    c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return { content: [{ type: "text" as const, text }], details: value, structuredContent: value,
    ...(status === "error" ? { isError: true } : {}) };
}
