import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { registerWriteToolHighlights } from "../harnesses/pi/extensions/write-tool-highlights.ts";

const CATPPUCCIN_THEME_PATH = new URL(
  "../harnesses/pi/themes/catppuccin-mocha.json",
  import.meta.url,
);
const PI_SETTINGS_PATH = new URL("../harnesses/pi/settings.json", import.meta.url);

class FakeComponent {
  children: FakeComponent[] = [];
  background: (text: string) => string = (text) => text;

  addChild(component: FakeComponent) {
    this.children.push(component);
  }

  clear() {
    this.children = [];
  }

  setBgFn(background: (text: string) => string) {
    this.background = background;
  }
}

const theme = {
  bg: (color: string, text: string) => `<${color}>${text}</${color}>`,
  getColorMode: () => "truecolor" as const,
};

function toolDefinition(name: "edit" | "write") {
  return {
    name,
    label: name,
    description: `${name} description`,
    parameters: {},
    execute: async () => ({ content: [{ type: "text", text: "done" }] }),
    renderCall: (_args: unknown, _theme: unknown, context: any) => {
      const component = context.lastComponent ?? new FakeComponent();
      if (name === "edit") context.state.callComponent = component;
      component.setBgFn((text: string) => `<original>${text}</original>`);
      return component;
    },
    renderResult: (_result: unknown, _options: unknown, _theme: unknown, context: any) => {
      context.state.callComponent?.setBgFn((text: string) => `<settled>${text}</settled>`);
      return context.lastComponent ?? new FakeComponent();
    },
  };
}

function registeredTools() {
  const tools: any[] = [];
  registerWriteToolHighlights(
    { registerTool: (definition: any) => tools.push(definition) } as any,
    {
      createBox: () => new FakeComponent() as any,
      createContainer: () => new FakeComponent() as any,
      createEditToolDefinition: () => toolDefinition("edit") as any,
      createWriteToolDefinition: () => toolDefinition("write") as any,
      cwd: "/project",
    },
  );
  return Object.fromEntries(tools.map((definition) => [definition.name, definition]));
}

function renderContext(overrides: Record<string, unknown> = {}) {
  return {
    args: {},
    state: {},
    lastComponent: undefined,
    isPartial: false,
    isError: false,
    ...overrides,
  } as any;
}

describe("Catppuccin Mocha theme", () => {
  test("uses hue-matched Catppuccin status colors", () => {
    const themeDefinition = JSON.parse(readFileSync(CATPPUCCIN_THEME_PATH, "utf8"));

    expect({
      success: themeDefinition.vars[themeDefinition.colors.success],
      error: themeDefinition.vars[themeDefinition.colors.error],
      warning: themeDefinition.vars[themeDefinition.colors.warning],
      successBackground: themeDefinition.vars[themeDefinition.colors.toolSuccessBg],
      errorBackground: themeDefinition.vars[themeDefinition.colors.toolErrorBg],
    }).toEqual({
      success: "#a6e3a1",
      error: "#f38ba8",
      warning: "#f9e2af",
      successBackground: "#324430",
      errorBackground: "#492a32",
    });
  });

  test("is the default Pi theme", () => {
    const settings = JSON.parse(readFileSync(PI_SETTINGS_PATH, "utf8"));

    expect(settings.theme).toBe("catppuccin-mocha");
  });
});

describe("write tool highlights", () => {
  test("registers only edit and write overrides", () => {
    expect(Object.keys(registeredTools()).sort()).toEqual(["edit", "write"]);
  });

  test("renders a successful write with the Catppuccin yellow background", () => {
    const { write } = registeredTools();
    const context = renderContext();
    const shell = write.renderCall({}, theme, context) as FakeComponent;

    expect(shell.background("write")).toBe("\u001b[48;2;75;68;53mwrite\u001b[49m");
  });

  test("keeps failed writes on the error background", () => {
    const { write } = registeredTools();
    const context = renderContext({ isError: true });
    const shell = write.renderCall({}, theme, context) as FakeComponent;

    expect(shell.background("write")).toBe("<toolErrorBg>write</toolErrorBg>");
  });

  test("keeps pending writes on the pending background", () => {
    const { write } = registeredTools();
    const context = renderContext({ isPartial: true });
    const shell = write.renderCall({}, theme, context) as FakeComponent;

    expect(shell.background("write")).toBe("<toolPendingBg>write</toolPendingBg>");
  });

  test("reapplies Catppuccin yellow after the edit result renderer settles", () => {
    const { edit } = registeredTools();
    const context = renderContext();
    const call = edit.renderCall({}, theme, context) as FakeComponent;

    edit.renderResult({ content: [] }, { expanded: false, isPartial: false }, theme, context);

    expect(call.background("edit")).toBe("\u001b[48;2;75;68;53medit\u001b[49m");
  });

  test("reapplies red after a failed edit settles", () => {
    const { edit } = registeredTools();
    const context = renderContext({ isError: true });
    const call = edit.renderCall({}, theme, context) as FakeComponent;

    edit.renderResult({ content: [] }, { expanded: false, isPartial: false }, theme, context);

    expect(call.background("edit")).toBe("<toolErrorBg>edit</toolErrorBg>");
  });

  test("uses a yellow 256-color fallback", () => {
    const { write } = registeredTools();
    const fallbackTheme = { ...theme, getColorMode: () => "256color" as const };
    const shell = write.renderCall({}, fallbackTheme, renderContext()) as FakeComponent;

    expect(shell.background("write")).toBe("\u001b[48;5;58mwrite\u001b[49m");
  });

  test("executes writes relative to the current session after a worktree transition", async () => {
    const tools: any[] = [];
    registerWriteToolHighlights(
      { registerTool: (definition: any) => tools.push(definition) } as any,
      {
        createBox: () => new FakeComponent() as any,
        createContainer: () => new FakeComponent() as any,
        createEditToolDefinition: () => toolDefinition("edit") as any,
        createWriteToolDefinition: (cwd) => ({
          ...toolDefinition("write"),
          execute: async () => ({ content: [{ type: "text", text: cwd }] }),
        }) as any,
        cwd: "/original",
      },
    );

    const write = tools.find((definition) => definition.name === "write");
    const result = await write.execute("id", {}, undefined, undefined, { cwd: "/worktree" });

    expect(result.content[0].text).toBe("/worktree");
  });
});
