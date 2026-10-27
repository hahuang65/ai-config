import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { stripTerminalSequences } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const safe = (text: string) => stripTerminalSequences(text).replace(/[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu, " ");
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Worklog object");
  return value as Record<string, unknown>;
}
function notify(ctx: ExtensionContext, text: string, level: "info" | "error") {
  try { if (ctx.hasUI) ctx.ui.notify(text, level); }
  catch { /* UI failure must not retry a recorded reminder. */ }
}

async function run(ctx: ExtensionContext, args: string[]) {
  const source = realpathSync(fileURLToPath(import.meta.url));
  const executable = resolve(dirname(source), "../../tools/worklog/target/release/wl");
  const { stdout } = await execute(executable, args, {
    cwd: ctx.cwd, timeout: 15_000, maxBuffer: 8 * 1024 * 1024, encoding: "utf8",
  });
  return object(JSON.parse(stdout));
}

function taskRow(value: unknown): string {
  const task = object(value);
  if (typeof task.id !== "number" || !Number.isSafeInteger(task.id) || task.id < 1 ||
    (task.state !== "planned" && task.state !== "active") || typeof task.title !== "string") {
    throw new Error("Invalid Worklog task");
  }
  const name = task.project === null ? null : object(task.project).name;
  if (name !== null && typeof name !== "string") throw new Error("Invalid Worklog project");
  return safe(`#${task.id} ${task.state} [${name === null ? "unassigned" : JSON.stringify(name)}] ${JSON.stringify(task.title)}`);
}

async function list(ctx: ExtensionContext) {
  try {
    const value = await run(ctx, ["--json"]);
    if (!Array.isArray(value.items) || value.total !== value.items.length || value.omitted !== 0) {
      throw new Error("Invalid Worklog collection");
    }
    const lines = value.items.map(taskRow);
    notify(ctx, lines.join("\n") || "No incomplete Worklog tasks.", "info");
  } catch {
    notify(ctx, "Unable to list Worklog tasks. Use the owned CLI with list --all-projects --limit 20 to inspect the error.", "error");
  }
}

export default function worklog(pi: ExtensionAPI) {
  pi.registerCommand("worklog", {
    description: "List incomplete Worklog tasks, or /worklog REMINDER to capture without interrupting the current run",
    handler: async (args, ctx) => {
      if (!ctx.hasUI) throw new Error("/worklog requires an interactive or RPC UI; use the owned Worklog CLI instead.");
      const title = args.trim();
      if (!title) return list(ctx);
      if (Buffer.byteLength(title) > 2048 || /\p{Cc}/u.test(title)) {
        notify(ctx, "Use /worklog REMINDER with a nonblank, single-line title of at most 2048 bytes.", "error");
        return;
      }
      try {
        const value = await run(ctx, ["note", "--json", "--project-path", ctx.cwd, "--", title]);
        const entry = object(value.entry);
        const project = object(entry.project);
        if (typeof entry.id !== "number" || !Number.isSafeInteger(entry.id) || entry.id < 1 ||
          entry.kind !== "note" || entry.text !== title || typeof project.name !== "string") {
          throw new Error("Invalid Worklog receipt");
        }
        notify(ctx, `Noted #${entry.id} [${safe(project.name)}] ${safe(title)}`, "info");
      } catch {
        notify(ctx, "Unable to confirm the reminder. Inspect Worklog history before retrying; it may already be recorded.", "error");
      }
    },
  });
}
