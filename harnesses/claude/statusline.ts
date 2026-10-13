// A bounded, self-contained Claude status line; no memory service or old source.
import { isAbsolute, sep } from "node:path";

const MAX_INPUT_BYTES = 1024 * 1024;
const MIN_WIDTH = 5;
const MAX_WIDTH = 240;
const GIT_TIMEOUT_MS = 300;
const COLOR = { location: "\u001b[38;2;249;226;175m", branch: "\u001b[38;2;203;166;247m",
  dim: "\u001b[38;2;166;173;200m", reset: "\u001b[0m" };

type Status = {
  cwd?: unknown;
  terminal_width?: unknown;
  thinking_level?: unknown;
  model?: { display_name?: unknown; id?: unknown; thinking_level?: unknown; is_subscription?: unknown;
    context_window?: unknown };
  cost?: { total_cost_usd?: unknown; is_subscription?: unknown };
  experimental_features_enabled?: unknown;
  context_window?: { total_input_tokens?: unknown; total_output_tokens?: unknown;
    total_cache_read_input_tokens?: unknown; total_cache_creation_input_tokens?: unknown;
    current_usage?: { input_tokens?: unknown; cache_read_input_tokens?: unknown;
      cache_creation_input_tokens?: unknown }; used_percentage?: unknown;
    context_window_size?: unknown; total_cost_usd?: unknown };
};

function safeText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, ""))
    .slice(0, maximum).join("");
}

function number(value: unknown, maximum: number): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= maximum
    ? value : undefined;
}

function environmentColumns(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d{0,2}$/.test(value)) return undefined;
  const columns = Number(value);
  return columns >= MIN_WIDTH && columns <= MAX_WIDTH ? columns : undefined;
}

async function currentBranch(cwd: string): Promise<string> {
  if (!cwd || !isAbsolute(cwd)) return "";
  try {
    const child = Bun.spawn(["/usr/bin/git", "-C", cwd, "--no-optional-locks", "branch", "--show-current"], {
      env: { HOME: process.env.HOME ?? "/", PATH: "/usr/bin:/bin" },
      stdin: "ignore", stdout: "pipe", stderr: "ignore",
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), GIT_TIMEOUT_MS);
    try {
      const [output, exit] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      return exit === 0 ? safeText(output.trim(), 80) : "";
    } finally { clearTimeout(timer); }
  } catch { return ""; }
}

function location(cwd: string): string {
  const home = process.env.HOME;
  if (!cwd || !isAbsolute(cwd)) return "unknown directory";
  if (home && (cwd === home || cwd.startsWith(home + sep))) {
    return `~${cwd.slice(home.length)}`;
  }
  return cwd;
}

function tokens(count: number): string {
  if (count < 1_000) return String(count);
  if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
  if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

function usage(input: Status): string {
  const window = input.context_window;
  const read = number(window?.total_cache_read_input_tokens, 1e12)
    ?? number(window?.current_usage?.cache_read_input_tokens, 1e12) ?? 0;
  const write = number(window?.total_cache_creation_input_tokens, 1e12)
    ?? number(window?.current_usage?.cache_creation_input_tokens, 1e12) ?? 0;
  const parts: string[] = [];
  for (const [label, value] of [
    ["↑", window?.total_input_tokens], ["↓", window?.total_output_tokens],
    ["📚", read], ["💾", write],
  ] as const) {
    const count = number(value, 1e12) ?? 0;
    if (count) parts.push(`${label}${tokens(count)}`);
  }
  const latest = window?.current_usage;
  const prompt = (number(latest?.input_tokens, 1e12) ?? 0)
    + (number(latest?.cache_read_input_tokens, 1e12) ?? 0)
    + (number(latest?.cache_creation_input_tokens, 1e12) ?? 0);
  if (prompt) parts.push(`🎯${((number(latest?.cache_read_input_tokens, 1e12) ?? 0) / prompt * 100).toFixed(1)}%`);
  const cost = number(input.cost?.total_cost_usd ?? window?.total_cost_usd, 100_000) ?? 0;
  const subscription = input.cost?.is_subscription === true || input.model?.is_subscription === true;
  parts.push(`$${cost.toFixed(3)}${subscription ? " (sub)" : ""}`);
  const percent = number(window?.used_percentage, 100);
  const size = number(window?.context_window_size ?? input.model?.context_window, 1e12) ?? 0;
  parts.push(`${percent === undefined ? "?" : percent.toFixed(1) + "%"}/${tokens(size)} (auto)`);
  if (input.experimental_features_enabled === true) parts.push("• xp");
  return parts.join(" ");
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
function clip(text: string, width: number): string {
  if (width <= 0) return "";
  if (Bun.stringWidth(text) <= width) return text;
  let clipped = "";
  for (const { segment } of graphemes.segment(text)) {
    if (Bun.stringWidth(clipped + segment) > width - 1) break;
    clipped += segment;
  }
  return `${clipped}…`;
}

async function main(): Promise<void> {
  let input: Status = {};
  try {
    const raw = await Bun.stdin.text();
    if (raw.length <= MAX_INPUT_BYTES) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) input = parsed as Status;
    }
  } catch { /* An incomplete status update is not a provider error. */ }
  const cwd = safeText(input.cwd, 1024);
  const branch = await currentBranch(cwd);
  const columns = number(input.terminal_width, MAX_WIDTH)
    ?? environmentColumns(process.env.COLUMNS) ?? 80;
  const width = Math.max(MIN_WIDTH, columns) - 4;
  const model = safeText(input.model?.display_name ?? input.model?.id, 60) || "no model";
  const thinking = safeText(input.thinking_level ?? input.model?.thinking_level, 20);
  const modelStatus = `${model}${thinking ? ` • ${thinking}` : ""}`;
  const directory = location(cwd);
  const firstPlain = `${directory}${branch ? ` (${branch})` : ""}`;
  const first = branch && Bun.stringWidth(firstPlain) <= width
    ? `${COLOR.location}${directory}${COLOR.reset} (${COLOR.branch}${branch}${COLOR.reset})`
    : `${COLOR.location}${clip(firstPlain, width)}${COLOR.reset}`;
  const stats = usage(input);
  const modelWidth = Bun.stringWidth(modelStatus);
  const available = width - modelWidth - 1;
  const left = available > 0 ? clip(stats, available) : "";
  const padding = " ".repeat(Math.max(1, width - Bun.stringWidth(left) - modelWidth));
  const second = available > 0
    ? `${COLOR.dim}${left}${COLOR.reset}${padding}${COLOR.dim}${modelStatus}${COLOR.reset}`
    : `${COLOR.dim}${clip(modelStatus, width)}${COLOR.reset}`;
  process.stdout.write(`${first}\n${second}\n`);
}

await main();
