import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import {
  installAgentMemoryFooter,
  renderAgentMemoryFooter,
} from "../../harnesses/pi/extensions/agentmemory/footer.ts";

const theme = {
  fg: (_color: string, text: string) => text,
};

describe("agentmemory status bars", () => {
  test("pi renders two lines with agentmemory on the first line right", () => {
    const lines = renderAgentMemoryFooter({
      location: "~/.dotfiles/ai (hh/agentmemory-integration)",
      memoryStatus: "🧠 agentmemory · recall explicit · capture full",
      stats: "↑12.3k ↓456 📚8.2k 💾1.1k 🎯82.4% $0.123 42.0%/200k (auto) • xp",
      model: "claude-fable-5 • medium",
    }, theme, 160);

    expect(lines).toHaveLength(2);
    expect(lines[0]).toEndWith("🧠 agentmemory · recall explicit · capture full");
    expect(lines[0].length).toBeGreaterThanOrEqual(159);
    expect(lines[1]).toContain("↑12.3k ↓456 📚8.2k 💾1.1k 🎯82.4% $0.123");
    expect(lines[1]).toEndWith("claude-fable-5 • medium");
  });

  test("pi colors the project path with the theme warning color", () => {
    let createFooter: ((tui: any, theme: any, footerData: any) => any) | undefined;
    const home = process.env.HOME ?? "/home/example";
    const context = {
      cwd: `${home}/project`,
      getContextUsage: () => undefined,
      model: undefined,
      sessionManager: {
        getBranch: () => [],
        getCwd: () => `${home}/project`,
        getSessionName: () => undefined,
      },
      ui: {
        setFooter: (factory: typeof createFooter) => {
          createFooter = factory;
        },
      },
    };

    installAgentMemoryFooter(context);
    const footer = createFooter?.(
      { requestRender() {} },
      { fg: (color: string, text: string) => `<${color}>${text}</${color}>` },
      {
        getExtensionStatuses: () => new Map(),
        getGitBranch: () => undefined,
        onBranchChange: () => undefined,
      },
    );

    expect(footer?.render(160)[0]).toContain("<warning>~/project</warning>");
  });

  // Claude Code clips statusline rows four columns short of COLUMNS (measured on
  // 2.1.236), so the script must right-align into that clipped budget.
  const CLAUDE_CLIP_MARGIN = 4;

  test("Claude statusline pads each line to the clipped terminal budget", () => {
    const script = new URL("../../harnesses/claude/statusline.sh", import.meta.url).pathname;
    const statuslineInput = JSON.stringify({
      cwd: "/tmp",
      session_id: "status-bars-test",
      model: { display_name: "claude-fable-5" },
      thinking_level: "medium",
      context_window: {
        total_input_tokens: 12345,
        total_output_tokens: 456,
        total_cache_read_input_tokens: 8200,
        total_cache_creation_input_tokens: 1100,
        current_usage: {
          input_tokens: 100,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 200,
        },
        used_percentage: 42.0,
        context_window_size: 200000,
      },
      cost: { total_cost_usd: 0.123 },
    });
    const columns = 100;

    const rendered = Bun.spawnSync(["bash", script], {
      stdin: Buffer.from(statuslineInput),
      env: { ...process.env, COLUMNS: String(columns) },
    });

    const lines = rendered.stdout.toString().replace(/\n$/, "").split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const plain = line.replace(/\[[0-9;]*m/g, "");
      expect(Bun.stringWidth(plain)).toBe(columns - CLAUDE_CLIP_MARGIN);
    }
  });

  test("Claude uses the same two-line placement", () => {
    const source = readFileSync(
      new URL("../../harnesses/claude/statusline.sh", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      'align_line "$location_plain" "$location_colored" "$memory_plain" "$memory_status"',
    );
    expect(source).toContain(
      'align_line "$stats_plain" "$stats_colored" "$model_status"',
    );
    expect(source.match(/^align_line "/gm)).toHaveLength(2);
    expect(source).toContain('location_plain="${location_plain} (${branch})"');
    for (const segment of ["↑", "↓", "📚", "💾", "🎯", "(auto)", "• xp"]) {
      expect(source).toContain(segment);
    }
  });
});
