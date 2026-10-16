import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const statusline = fileURLToPath(new URL("../harnesses/claude/statusline.ts", import.meta.url));

test("Claude retains the older token, cache, context, cost, and model display without agentmemory", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-status-")));
  try {
    const child = Bun.spawn([Bun.which("bun")!, statusline], {
      env: { HOME: home, PATH: "/usr/bin:/bin", TERM: "dumb" },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write(JSON.stringify({
      cwd: join(home, "project"), terminal_width: 120,
      model: { display_name: "Fixture Model" }, thinking_level: "high",
      cost: { total_cost_usd: 0.013 },
      context_window: { total_input_tokens: 1_500, total_output_tokens: 300,
        total_cache_read_input_tokens: 800, total_cache_creation_input_tokens: 100,
        current_usage: { input_tokens: 1_000, cache_read_input_tokens: 500,
          cache_creation_input_tokens: 100 }, used_percentage: 23.5, context_window_size: 128_000 },
    }));
    child.stdin.end();
    const [output, errors, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(status, errors).toBe(0);
    const rows = output.trimEnd().split("\n");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("~/project");
    expect(output).toContain("\u001b[38;2;249;226;175m");
    expect(output).toContain("\u001b[38;2;166;173;200m");
    expect(rows[1]).toContain("↑1.5k ↓300 📚800 💾100 🎯31.3% $0.013 23.5%/128k (auto)");
    expect(rows[0]).toContain("Fixture Model • high");
    expect(output).not.toContain("agentmemory");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

async function renderOutput(input: object, columns = "120"): Promise<string> {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-status-native-")));
  try {
    const child = Bun.spawn([Bun.which("bun")!, statusline], {
      env: { HOME: home, PATH: "/usr/bin:/bin", TERM: "dumb", COLUMNS: columns },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write(JSON.stringify({ cwd: home, ...input }));
    child.stdin.end();
    const [output, errors, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(status, errors).toBe(0);
    return output;
  } finally { rmSync(home, { recursive: true, force: true }); }
}

async function renderStatus(input: object, columns = "120"): Promise<string[]> {
  return (await renderOutput(input, columns)).trimEnd().split("\n");
}

test.each(["20", "120", "300"])("Claude emits exactly two occupied rows without a trailing newline at %s columns", async columns => {
  const output = await renderOutput({ model: { display_name: "Opus" }, effort: { level: "medium" } }, columns);
  const rows = output.replace(/\u001b\[[0-9;]*m/g, "").split("\n");
  expect(rows).toHaveLength(2);
  expect(rows.every(row => row.trim().length > 0)).toBe(true);
  expect(output.endsWith("\n")).toBe(false);
  expect(rows[1]).toBe(rows[1].trimEnd());
});

test("Claude right-aligns model and effort on the first row and leaves usage on the second", async () => {
  const rows = await renderStatus({ session_name: "Compact footer", model: { display_name: "Opus" },
    effort: { level: "medium" }, context_window: { total_input_tokens: 35_000,
      used_percentage: 4, context_window_size: 1_000_000 } });
  const plain = rows.map(row => row.replace(/\u001b\[[0-9;]*m/g, ""));
  expect(plain[0]).toMatch(/^~ • Compact footer +Opus • medium$/);
  expect(Bun.stringWidth(plain[0])).toBe(116);
  expect(plain[1]).toBe("↑35k $0.000 4.0%/1.0M (auto)");
});

test("Claude shows the native reasoning effort beside the model", async () => {
  const rows = await renderStatus({ model: { display_name: "Opus" },
    effort: { level: "high" }, thinking: { enabled: true }, thinking_level: "low" });
  expect(rows[0]).toContain("Opus • high");
});

test("Claude shows disabled thinking instead of a retained effort setting", async () => {
  const rows = await renderStatus({ model: { display_name: "Opus" },
    effort: { level: "high" }, thinking: { enabled: false }, thinking_level: "medium" });
  expect(rows[0]).toContain("Opus • thinking off");
});

test("Claude shows enabled thinking when a model has no effort parameter", async () => {
  const rows = await renderStatus({ model: { display_name: "Sonnet" }, thinking: { enabled: true } });
  expect(rows[0]).toContain("Sonnet • thinking on");
});

test("Claude shows the session name on the location row like Pi", async () => {
  const rows = await renderStatus({ session_name: "Statusline parity", model: { display_name: "Opus" } });
  expect(rows[0].replace(/\u001b\[[0-9;]*m/g, "")).toMatch(/^~ • Statusline parity +Opus$/);
  expect(rows[1]).not.toContain("Statusline parity");
});

test("Claude uses wide terminal columns instead of falling back to an 80-column display", async () => {
  const rows = await renderStatus({ model: { display_name: "Opus" }, effort: { level: "high" },
    context_window: { total_input_tokens: 12_000, total_output_tokens: 2_000,
      current_usage: { input_tokens: 1_000, cache_read_input_tokens: 5_000,
        cache_creation_input_tokens: 500 }, used_percentage: 42, context_window_size: 200_000 },
    cost: { total_cost_usd: 0.123 } }, "300");
  expect(Bun.stringWidth(rows[0])).toBe(296);
  expect(rows[1]).toContain("↑12k ↓2.0k 📚5.0k 💾500 🎯76.9% $0.123 42.0%/200k (auto)");
  expect(rows[0]).toContain("Opus • high");
});

test("Claude sanitizes and clips native session and effort text", async () => {
  const rows = await renderStatus({ session_name: `Task\n\u001b[31m\u202e${"📁".repeat(100)}`,
    model: { display_name: "Opus" }, effort: { level: "high\n\u001b[31m\u202e" } }, "42");
  expect(rows).toHaveLength(2);
  expect(rows.every((row) => Bun.stringWidth(row) <= 38)).toBe(true);
  expect(rows[0]).toContain("…");
  expect(rows[0]).toContain("Opus • high");
  expect(rows.join("\n")).not.toContain("\u001b[31m");
  expect(rows.join("\n")).not.toContain("\u202e");
});

test.each([["4096", 4092], ["4097", 76], ["999999999", 76]] as const)(
  "Claude bounds output for COLUMNS=%s", async (columns, width) => {
    const rows = await renderStatus({ model: { display_name: "Opus" } }, columns);
    expect(Bun.stringWidth(rows[0])).toBe(width);
  },
);

test("Claude does not invent a thinking state when native and legacy data are absent", async () => {
  const rows = await renderStatus({ model: { display_name: "Opus" } });
  expect(rows[0]).not.toContain("•");
  expect(rows[0]).not.toContain("thinking");
});

test("Claude status clips to display columns and strips untrusted terminal controls", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-status-columns-")));
  try {
    const child = Bun.spawn([Bun.which("bun")!, statusline], {
      env: { HOME: home, PATH: "/usr/bin:/bin", TERM: "dumb" },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write(JSON.stringify({ cwd: "/tmp/📁📁📁📁📁📁📁📁📁📁",
      model: { display_name: "🧠🧠🧠🧠🧠\u001b[31m\u202e" },
      context_window: { used_percentage: 43, context_window_size: 128_000 },
      terminal_width: 32 }));
    child.stdin.end();
    const output = await new Response(child.stdout).text();
    expect(await child.exited).toBe(0);
    const lines = output.trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => Bun.stringWidth(line) <= 28)).toBe(true);
    expect(output).not.toContain("\u001b[31m");
    expect(output).not.toContain("\u202e");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("a narrow COLUMNS fallback does not render past the terminal", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-status-narrow-")));
  try {
    const child = Bun.spawn([Bun.which("bun")!, statusline], {
      env: { HOME: home, PATH: "/usr/bin:/bin", TERM: "dumb", COLUMNS: "20" },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write(JSON.stringify({ cwd: "/tmp/long-location", model: { id: "model" } }));
    child.stdin.end();
    const [output, status] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    expect(status).toBe(0);
    const rows = output.trimEnd().split("\n");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => Bun.stringWidth(row) <= 16)).toBe(true);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("Claude status uses COLUMNS when a status update omits terminal_width", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "claude-status-fallback-")));
  try {
    const child = Bun.spawn([Bun.which("bun")!, statusline], {
      env: { HOME: home, PATH: "/usr/bin:/bin", TERM: "dumb", COLUMNS: "42" },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write(JSON.stringify({ cwd: `/tmp/${"📁".repeat(24)}`,
      model: { display_name: "fixture-model" }, context_window: { used_percentage: 43 } }));
    child.stdin.end();
    const [output, errors, status] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    expect(status, errors).toBe(0);
    const rows = output.trimEnd().split("\n");
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => Bun.stringWidth(row) <= 38)).toBe(true);
    expect(rows[0]).toContain("…");
    expect(rows[0]).toContain("fixture-model");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
