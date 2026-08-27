import { expect, test } from "bun:test";

import { createOrchardExtension } from "../harnesses/pi/extensions/orchard";

function machineOutcome(command: string, payload: Record<string, unknown>) {
  return JSON.stringify({ protocolVersion: 1, command, ...payload });
}

function registerExtension(outputs: string[], dependencyOverrides: Record<string, unknown> = {}) {
  const tools: any[] = [];
  const commands = new Map<string, any>();
  const handlers = new Map<string, any[]>();
  const queued: string[] = [];
  let editorText = "";
  const executions: Array<{ command: string; args: string[]; cwd?: string }> = [];
  const forks: Array<{ source: string; target: string }> = [];
  const reportedCwds: string[] = [];
  const pi = {
    registerTool: (tool: any) => tools.push(tool),
    registerCommand: (name: string, command: any) => commands.set(name, command),
    on: (event: string, handler: any) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    sendUserMessage: (message: string) => queued.push(message),
  };
  createOrchardExtension({
    randomToken: () => "authenticated-token",
    processId: 4242,
    forkSession: (source: string, target: string) => {
      forks.push({ source, target });
      return "/sessions/fork.jsonl";
    },
    reportCwd: (cwd: string) => reportedCwds.push(cwd),
    executeCli: async (args: string[], cwd: string) => {
      executions.push({ command: "orchard", args, cwd });
      return { stdout: outputs.shift() ?? "", stderr: "", code: 0, killed: false };
    },
    ...dependencyOverrides,
  } as any)(pi as any);
  const originalExecute = tools[0].execute.bind(tools[0]);
  tools[0].execute = (...args: any[]) => {
    args[4] = {
      ...args[4],
      ui: args[4]?.ui ?? {
        getEditorText: () => editorText,
        setEditorText: (value: string) => { editorText = value; },
        notify: () => {},
      },
    };
    return originalExecute(...args);
  };
  return {
    tools,
    commands,
    handlers,
    queued,
    executions,
    forks,
    reportedCwds,
    get editorText() { return editorText; },
    context: (cwd: string) => ({
      cwd,
      ui: {
        getEditorText: () => editorText,
        setEditorText: (value: string) => { editorText = value; },
        notify: () => {},
      },
    }),
  };
}

test("Orchard tool guidance continues non-transition outcomes in the current turn", () => {
  const extension = registerExtension([]);
  const guidance = extension.tools[0].promptGuidelines.join("\n");

  expect(guidance).toContain("needs-commit");
  expect(guidance).toContain("continue the calling workflow in the same turn");
  expect(guidance).toContain("Only when orchard_transition queues a transition");
});

test("Orchard tool preloads one authenticated transition command and terminates the turn", async () => {
  const extension = registerExtension([
    machineOutcome("new", {
      project: { name: "alpha", root: "/projects/alpha", trunk: "main" },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "cli-operation", targetPath: "/home/.orchard/alpha/feature" },
    }),
    machineOutcome("enter", {
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
  ]);

  const result = await extension.tools[0].execute(
    "tool-call",
    { command: "new", args: ["Feature", "--offline"], continuation: "Continue the build workflow." },
    undefined,
    undefined,
    extension.context("/projects/alpha"),
  );

  expect(result.terminate).toBe(true);
  expect(extension.editorText).toBe("/orchard-continue authenticated-token");
  expect(extension.queued).toEqual([]);
  expect(extension.executions.map((execution) => execution.args)).toEqual([
    ["new", "Feature", "--offline", "--json"],
    ["enter", "feature", "--owner-pid", "4242", "--json"],
  ]);
});

test("Orchard deliver returns needs-commit without forcing a session transition", async () => {
  const extension = registerExtension([
    machineOutcome("deliver", {
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      commit: { status: " M feature.ts" },
      delivery: { status: "needs-commit" },
      transition: { kind: "none", targetPath: "/home/.orchard/alpha/feature" },
    }),
  ]);

  const result = await extension.tools[0].execute(
    "tool-call",
    { command: "deliver", args: [], continuation: "Continue delivery." },
    undefined,
    undefined,
    extension.context("/home/.orchard/alpha/feature"),
  );

  expect(result.terminate).toBe(false);
  expect(result.details.deliveryStatus).toBe("needs-commit");
  expect(extension.editorText).toBe("");
  expect(extension.executions.map((execution) => execution.args)).toEqual([["deliver", "--json"]]);
});

test("non-transition delivery keeps internal operation IDs out of model-visible output", async () => {
  const extension = registerExtension([
    machineOutcome("deliver", {
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      cleanup: { status: "completed", operationId: "internal-operation-id" },
      delivery: { status: "integrated", strategy: "local" },
      transition: { kind: "none", targetPath: "/projects/alpha" },
    }),
  ]);

  const result = await extension.tools[0].execute(
    "tool-call",
    { command: "deliver", args: ["feature"], continuation: "Continue." },
    undefined,
    undefined,
    extension.context("/projects/alpha"),
  );

  expect(result.content[0].text).toContain("integrated");
  expect(result.content[0].text).toContain("/home/.orchard/alpha/feature");
  expect(result.content[0].text).not.toContain("internal-operation-id");
  expect(JSON.stringify(result.details)).not.toContain("internal-operation-id");
});

test("Orchard refuses to overwrite an existing pi editor draft", async () => {
  const extension = registerExtension([]);
  const context = extension.context("/projects/alpha");
  context.ui.setEditorText("unfinished prompt");

  await expect(extension.tools[0].execute(
    "tool-call",
    { command: "new", args: ["Feature", "--offline"], continuation: "Continue." },
    undefined,
    undefined,
    context,
  )).rejects.toThrow("will not overwrite the current editor draft");

  expect(extension.editorText).toBe("unfinished prompt");
  expect(extension.executions).toEqual([]);
});

test("pi refuses a second lifecycle request while confirmation is pending", async () => {
  const extension = registerExtension([
    machineOutcome("enter", {
      project: { name: "alpha", root: "/projects/alpha", trunk: "main" },
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
  ]);
  const context = extension.context("/projects/alpha");
  await extension.tools[0].execute(
    "first-tool-call",
    { command: "enter", args: ["feature"], continuation: "Continue." },
    undefined,
    undefined,
    context,
  );
  context.ui.setEditorText("");

  await expect(extension.tools[0].execute(
    "second-tool-call",
    { command: "new", args: ["other", "--offline"], continuation: "Continue elsewhere." },
    undefined,
    undefined,
    context,
  )).rejects.toThrow("already awaiting confirmation");
  expect(extension.executions).toHaveLength(1);
});

test("authenticated command forks persisted history and switches the same pi session", async () => {
  const extension = registerExtension([
    machineOutcome("enter", {
      project: { name: "alpha", root: "/projects/alpha", trunk: "main" },
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
  ]);
  await extension.tools[0].execute(
    "tool-call",
    { command: "enter", args: ["feature"], continuation: "Continue the approved slice." },
    undefined,
    undefined,
    { cwd: "/projects/alpha" },
  );
  const switched: string[] = [];
  const continuations: string[] = [];
  const notifications: string[] = [];
  const commandContext = {
    mode: "tui",
    sessionManager: { getSessionFile: () => "/sessions/source.jsonl" },
    ui: { notify: (message: string) => notifications.push(message) },
    switchSession: async (sessionPath: string, options: any) => {
      switched.push(sessionPath);
      await options.withSession({
        sendUserMessage: async (message: string) => continuations.push(message),
      });
      return { cancelled: false };
    },
  };

  await extension.commands.get("orchard-continue").handler("authenticated-token", commandContext);

  expect(extension.forks).toEqual([{
    source: "/sessions/source.jsonl",
    target: "/home/.orchard/alpha/feature",
  }]);
  expect(switched).toEqual(["/sessions/fork.jsonl"]);
  expect(extension.reportedCwds).toEqual(["/home/.orchard/alpha/feature"]);
  expect(continuations).toEqual(["Continue the approved slice."]);
  expect(notifications).toEqual([]);

  await extension.commands.get("orchard-continue").handler("authenticated-token", commandContext);
  expect(notifications).toEqual(["Orchard transition request is missing or expired"]);
});

test("expired pi transition tokens fail closed without switching", async () => {
  let now = 1_000;
  const extension = registerExtension([
    machineOutcome("enter", {
      project: { name: "alpha", root: "/projects/alpha", trunk: "main" },
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
  ], { now: () => now });
  await extension.tools[0].execute(
    "tool-call",
    { command: "enter", args: ["feature"], continuation: "Continue." },
    undefined,
    undefined,
    extension.context("/projects/alpha"),
  );
  now += 10 * 60 * 1_000 + 1;
  const notifications: string[] = [];

  await extension.commands.get("orchard-continue").handler("authenticated-token", {
    mode: "tui",
    sessionManager: { getSessionFile: () => "/sessions/source.jsonl" },
    ui: { notify: (message: string) => notifications.push(message) },
  });

  expect(notifications).toEqual(["Orchard transition request is missing or expired"]);
  expect(extension.forks).toEqual([]);
});

test("pi delivery return releases ownership and finalizes cleanup after switching to main", async () => {
  const extension = registerExtension([
    machineOutcome("status", {
      projects: [{
        name: "alpha",
        root: "/projects/alpha",
        slots: [{ lifecycle: "task", path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" }],
      }],
    }),
    machineOutcome("enter", {
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
    machineOutcome("deliver", {
      project: { name: "alpha", root: "/projects/alpha", trunk: "main" },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      cleanup: { requested: true },
      transition: { kind: "return-main", operationId: "cleanup-operation", targetPath: "/projects/alpha" },
    }),
    machineOutcome("enter", { released: true }),
    machineOutcome("deliver", { cleanup: { status: "completed", operationId: "cleanup-operation" } }),
  ]);
  await extension.handlers.get("session_start")[0]({}, { cwd: "/home/.orchard/alpha/feature" });
  const queued = await extension.tools[0].execute(
    "tool-call",
    { command: "deliver", args: [], continuation: "Continue from the main project directory." },
    undefined,
    undefined,
    { cwd: "/home/.orchard/alpha/feature" },
  );
  expect(JSON.stringify(queued)).not.toContain("cleanup-operation");
  const continuations: string[] = [];
  const commandContext = {
    mode: "tui",
    sessionManager: { getSessionFile: () => "/sessions/task.jsonl" },
    ui: { notify: () => {} },
    switchSession: async (_sessionPath: string, options: any) => {
      await options.withSession({
        sendUserMessage: async (message: string) => continuations.push(message),
        ui: { notify: () => {} },
      });
      return { cancelled: false };
    },
  };

  await extension.commands.get("orchard-continue").handler("authenticated-token", commandContext);

  expect(extension.executions.map((execution) => execution.args)).toEqual([
    ["status", "--json"],
    ["enter", "feature", "--owner-pid", "4242", "--json"],
    ["deliver", "--json"],
    ["enter", "feature", "--release-owner", "owner-token", "--json"],
    ["deliver", "--finalize-operation", "cleanup-operation", "--json"],
  ]);
  expect(extension.forks.at(-1)).toEqual({ source: "/sessions/task.jsonl", target: "/projects/alpha" });
  expect(extension.reportedCwds).toEqual(["/projects/alpha"]);
  expect(continuations).toEqual(["Continue from the main project directory."]);
});

test("missing session persistence preserves the task and refuses transition", async () => {
  const extension = registerExtension([
    machineOutcome("enter", {
      project: { name: "alpha", root: "/projects/alpha", trunk: "main" },
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
  ]);
  await extension.tools[0].execute(
    "tool-call",
    { command: "enter", args: ["feature"], continuation: "Continue." },
    undefined,
    undefined,
    { cwd: "/projects/alpha" },
  );
  const notifications: string[] = [];

  await extension.commands.get("orchard-continue").handler("authenticated-token", {
    mode: "tui",
    sessionManager: { getSessionFile: () => undefined },
    ui: { notify: (message: string) => notifications.push(message) },
  });

  expect(notifications).toEqual(["Orchard cannot transition an unpersisted pi session"]);
  expect(extension.forks).toEqual([]);
  expect(extension.executions).toHaveLength(1);
});

test("switch failure reports the preserved worktree without cleanup", async () => {
  const extension = registerExtension([
    machineOutcome("enter", {
      project: { name: "alpha", root: "/projects/alpha", trunk: "main" },
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
  ]);
  await extension.tools[0].execute(
    "tool-call",
    { command: "enter", args: ["feature"], continuation: "Continue." },
    undefined,
    undefined,
    { cwd: "/projects/alpha" },
  );
  const notifications: string[] = [];
  const transition = extension.commands.get("orchard-continue").handler("authenticated-token", {
    mode: "tui",
    sessionManager: { getSessionFile: () => "/sessions/source.jsonl" },
    ui: { notify: (message: string) => notifications.push(message) },
    switchSession: async () => { throw new Error("switch failed"); },
  });

  await expect(transition).rejects.toThrow("switch failed");
  expect(notifications).toEqual([
    "Orchard transition failed; work remains at /home/.orchard/alpha/feature",
  ]);
  expect(extension.executions).toHaveLength(1);
});

test("clearing the prefilled command preserves ownership until ordinary shutdown", async () => {
  const extension = registerExtension([
    machineOutcome("enter", {
      project: { name: "alpha", root: "/projects/alpha", trunk: "main" },
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
    machineOutcome("enter", { released: true }),
  ]);
  const context = extension.context("/projects/alpha");
  await extension.tools[0].execute(
    "tool-call",
    { command: "enter", args: ["feature"], continuation: "Continue." },
    undefined,
    undefined,
    context,
  );

  context.ui.setEditorText("");
  expect(extension.executions).toHaveLength(1);
  await extension.handlers.get("session_shutdown")[0]({}, { cwd: "/projects/alpha" });

  expect(extension.executions.map((execution) => execution.args)).toEqual([
    ["enter", "feature", "--owner-pid", "4242", "--json"],
    ["enter", "feature", "--release-owner", "owner-token", "--json"],
  ]);
});

test("ordinary pi session shutdown releases its active Orchard owner", async () => {
  const extension = registerExtension([
    machineOutcome("status", {
      projects: [{
        name: "alpha",
        root: "/projects/alpha",
        slots: [{ lifecycle: "task", path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" }],
      }],
    }),
    machineOutcome("enter", {
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
    machineOutcome("enter", { released: true }),
  ]);

  await extension.handlers.get("session_start")[0]({}, { cwd: "/home/.orchard/alpha/feature" });
  await extension.handlers.get("session_shutdown")[0]({}, { cwd: "/home/.orchard/alpha/feature" });

  expect(extension.executions.map((execution) => execution.args)).toEqual([
    ["status", "--json"],
    ["enter", "feature", "--owner-pid", "4242", "--json"],
    ["enter", "feature", "--release-owner", "owner-token", "--json"],
  ]);
});

test("cancelled pi switch keeps ownership and reports the safe task path", async () => {
  const extension = registerExtension([
    machineOutcome("enter", {
      project: { name: "alpha", root: "/projects/alpha", trunk: "main" },
      owner: { token: "owner-token", pid: 4242 },
      worktree: { path: "/home/.orchard/alpha/feature", intent: "feature", branch: "feature" },
      transition: { kind: "enter-worktree", operationId: "owner-token", targetPath: "/home/.orchard/alpha/feature" },
    }),
  ]);
  await extension.tools[0].execute(
    "tool-call",
    { command: "enter", args: ["feature"], continuation: "Continue." },
    undefined,
    undefined,
    { cwd: "/projects/alpha" },
  );
  const notifications: string[] = [];

  await extension.commands.get("orchard-continue").handler("authenticated-token", {
    mode: "tui",
    sessionManager: { getSessionFile: () => "/sessions/source.jsonl" },
    ui: { notify: (message: string) => notifications.push(message) },
    switchSession: async () => ({ cancelled: true }),
  });

  expect(notifications).toEqual([
    "Orchard transition was cancelled; work remains at /home/.orchard/alpha/feature",
  ]);
  expect(extension.executions).toHaveLength(1);
});
