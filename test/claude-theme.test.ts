import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const CLAUDE_CAPTURE_PATH = new URL(
  "../harnesses/claude/hooks/agentmemory-capture.ts",
  import.meta.url,
);
const CLAUDE_SETTINGS_PATH = new URL("../harnesses/claude/settings.json", import.meta.url);
const CLAUDE_STATUSLINE_PATH = new URL("../harnesses/claude/statusline.sh", import.meta.url);
const CLAUDE_THEME_PATH = new URL(
  "../harnesses/claude/themes/catppuccin-mocha.json",
  import.meta.url,
);

function readJson(url: URL) {
  return JSON.parse(readFileSync(url, "utf8"));
}

describe("Claude Catppuccin Mocha theme", () => {
  test("maps Claude interface roles to the Catppuccin Mocha palette", () => {
    const theme = readJson(CLAUDE_THEME_PATH);

    expect({
      name: theme.name,
      base: theme.base,
      accent: theme.overrides.claude,
      text: theme.overrides.text,
      success: theme.overrides.success,
      error: theme.overrides.error,
      warning: theme.overrides.warning,
      promptBorder: theme.overrides.promptBorder,
      userMessageBackground: theme.overrides.userMessageBackground,
      diffAdded: theme.overrides.diffAdded,
      diffRemoved: theme.overrides.diffRemoved,
    }).toEqual({
      name: "Catppuccin Mocha",
      base: "dark",
      accent: "#cba6f7",
      text: "#cdd6f4",
      success: "#a6e3a1",
      error: "#f38ba8",
      warning: "#f9e2af",
      promptBorder: "#b4befe",
      userMessageBackground: "#313244",
      diffAdded: "#324430",
      diffRemoved: "#492a32",
    });
  });

  test("selects Catppuccin Mocha by default", () => {
    expect(readJson(CLAUDE_SETTINGS_PATH).theme).toBe("custom:catppuccin-mocha");
  });

  test("uses Catppuccin colors in the custom status line", () => {
    const statusline = readFileSync(CLAUDE_STATUSLINE_PATH, "utf8");

    expect(statusline).toContain("LOCATION=$'\\033[38;2;249;226;175m'");
    expect(statusline).toContain("BRANCH=$'\\033[38;2;203;166;247m'");
    expect(statusline).toContain("DIM=$'\\033[38;2;166;173;200m'");
    expect(statusline).toContain("RED=$'\\033[38;2;243;139;168m'");
  });

  test("uses Catppuccin status colors for agentmemory", () => {
    const capture = readFileSync(CLAUDE_CAPTURE_PATH, "utf8");

    expect(capture).toContain('const CATPPUCCIN_GREEN = "\\u001b[38;2;166;227;161m"');
    expect(capture).toContain('const CATPPUCCIN_RED = "\\u001b[38;2;243;139;168m"');
  });
});
