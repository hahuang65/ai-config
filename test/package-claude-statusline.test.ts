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
    expect(rows[1]).toContain("Fixture Model • high");
    expect(output).not.toContain("agentmemory");
  } finally { rmSync(home, { recursive: true, force: true }); }
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
    expect(rows[1]).toContain("fixture-model");
  } finally { rmSync(home, { recursive: true, force: true }); }
});
