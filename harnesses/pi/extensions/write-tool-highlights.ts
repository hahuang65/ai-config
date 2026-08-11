import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const WRITE_BACKGROUND_TRUECOLOR = "\u001b[48;2;74;64;40m";
const WRITE_BACKGROUND_256 = "\u001b[48;5;58m";
const RESET_BACKGROUND = "\u001b[49m";
const HIGHLIGHT_STATE = Symbol("write-tool-highlight");

type Background = (text: string) => string;

type RenderComponent = {
  addChild?: (component: RenderComponent) => void;
  clear?: () => void;
  setBgFn?: (background: Background) => void;
};

type RenderTheme = {
  bg: (color: "toolPendingBg" | "toolErrorBg", text: string) => string;
  getColorMode: () => "truecolor" | "256color";
};

type RenderContext = {
  isError: boolean;
  isPartial: boolean;
  lastComponent?: RenderComponent;
  state: Record<PropertyKey, unknown>;
};

type ToolExecutionContext = { cwd: string };

type ToolDefinition = {
  name: string;
  execute: (
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: unknown,
    context: ToolExecutionContext,
  ) => Promise<unknown>;
  renderCall?: (args: unknown, theme: RenderTheme, context: RenderContext) => RenderComponent;
  renderResult?: (
    result: unknown,
    options: unknown,
    theme: RenderTheme,
    context: RenderContext,
  ) => RenderComponent;
  [key: string]: unknown;
};

type HighlightRenderState = {
  call?: RenderComponent;
  result?: RenderComponent;
  shell?: RenderComponent;
  resultPlaceholder?: RenderComponent;
};

type HighlightDependencies = {
  createBox: () => RenderComponent;
  createContainer: () => RenderComponent;
  createEditToolDefinition: (cwd: string) => ToolDefinition;
  createWriteToolDefinition: (cwd: string) => ToolDefinition;
  cwd: string;
};

function amberBackground(theme: RenderTheme): Background {
  const prefix = theme.getColorMode() === "256color"
    ? WRITE_BACKGROUND_256
    : WRITE_BACKGROUND_TRUECOLOR;
  return (text) => `${prefix}${text}${RESET_BACKGROUND}`;
}

function statusBackground(theme: RenderTheme, context: RenderContext): Background {
  if (context.isPartial) return (text) => theme.bg("toolPendingBg", text);
  if (context.isError) return (text) => theme.bg("toolErrorBg", text);
  return amberBackground(theme);
}

function highlightState(context: RenderContext): HighlightRenderState {
  const existing = context.state[HIGHLIGHT_STATE] as HighlightRenderState | undefined;
  if (existing) return existing;
  const created: HighlightRenderState = {};
  context.state[HIGHLIGHT_STATE] = created;
  return created;
}

function requireRenderer(
  renderer: ToolDefinition["renderCall"] | ToolDefinition["renderResult"],
  toolName: string,
): NonNullable<typeof renderer> {
  if (renderer) return renderer;
  throw new Error(`Pi's ${toolName} tool renderer is unavailable`);
}

function highlightEdit(definition: ToolDefinition): ToolDefinition {
  const renderCall = requireRenderer(definition.renderCall, "edit") as NonNullable<ToolDefinition["renderCall"]>;
  const renderResult = requireRenderer(definition.renderResult, "edit") as NonNullable<ToolDefinition["renderResult"]>;
  return {
    ...definition,
    renderCall(args, theme, context) {
      const component = renderCall(args, theme, context);
      highlightState(context).call = component;
      component.setBgFn?.(statusBackground(theme, context));
      return component;
    },
    renderResult(result, options, theme, context) {
      const component = renderResult(result, options, theme, context);
      highlightState(context).call?.setBgFn?.(statusBackground(theme, context));
      return component;
    },
  };
}

function rebuildWriteShell(
  definition: ToolDefinition,
  dependencies: HighlightDependencies,
  args: unknown,
  theme: RenderTheme,
  context: RenderContext,
): RenderComponent {
  const state = highlightState(context);
  const renderCall = requireRenderer(definition.renderCall, "write") as NonNullable<ToolDefinition["renderCall"]>;
  state.call = renderCall(args, theme, { ...context, lastComponent: state.call });
  state.shell ??= dependencies.createBox();
  state.shell.clear?.();
  state.shell.setBgFn?.(statusBackground(theme, context));
  state.shell.addChild?.(state.call);
  return state.shell;
}

function highlightWrite(
  definition: ToolDefinition,
  dependencies: HighlightDependencies,
): ToolDefinition {
  const renderResult = requireRenderer(definition.renderResult, "write") as NonNullable<ToolDefinition["renderResult"]>;
  return {
    ...definition,
    renderShell: "self",
    renderCall: (args, theme, context) =>
      rebuildWriteShell(definition, dependencies, args, theme, context),
    renderResult(result, options, theme, context) {
      const state = highlightState(context);
      state.result = renderResult(result, options, theme, {
        ...context,
        lastComponent: state.result,
      });
      state.shell?.setBgFn?.(statusBackground(theme, context));
      state.shell?.addChild?.(state.result);
      state.resultPlaceholder ??= dependencies.createContainer();
      state.resultPlaceholder.clear?.();
      return state.resultPlaceholder;
    },
  };
}

function executeFromCurrentCwd(
  definition: ToolDefinition,
  createDefinition: (cwd: string) => ToolDefinition,
): ToolDefinition {
  return {
    ...definition,
    execute(toolCallId, params, signal, onUpdate, context) {
      const currentDefinition = createDefinition(context.cwd);
      return currentDefinition.execute(toolCallId, params, signal, onUpdate, context);
    },
  };
}

export function registerWriteToolHighlights(
  pi: Pick<ExtensionAPI, "registerTool">,
  dependencies: HighlightDependencies,
): void {
  const edit = executeFromCurrentCwd(
    dependencies.createEditToolDefinition(dependencies.cwd),
    dependencies.createEditToolDefinition,
  );
  const write = executeFromCurrentCwd(
    dependencies.createWriteToolDefinition(dependencies.cwd),
    dependencies.createWriteToolDefinition,
  );
  pi.registerTool(highlightEdit(edit) as never);
  pi.registerTool(highlightWrite(write, dependencies) as never);
}

export default async function writeToolHighlights(pi: ExtensionAPI): Promise<void> {
  const [{ createEditToolDefinition, createWriteToolDefinition }, { Box, Container }] =
    await Promise.all([
      import("@earendil-works/pi-coding-agent"),
      import("@earendil-works/pi-tui"),
    ]);
  registerWriteToolHighlights(pi, {
    createBox: () => new Box(1, 1, (text) => text) as RenderComponent,
    createContainer: () => new Container() as RenderComponent,
    createEditToolDefinition: (cwd) => createEditToolDefinition(cwd) as ToolDefinition,
    createWriteToolDefinition: (cwd) => createWriteToolDefinition(cwd) as ToolDefinition,
    cwd: process.cwd(),
  });
}
