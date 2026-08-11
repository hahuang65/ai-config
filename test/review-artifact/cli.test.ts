import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runReviewCommand } from "../../skills/review-artifact/runtime/cli.mjs";
import { startReviewServer } from "../../skills/review-artifact/runtime/server.mjs";

const servers: Array<{ close(): Promise<void> }> = [];

async function runReviewArtifact(
  args: string[],
  stateDirectory: string,
  environment: Record<string, string> = {},
) {
  const executable = path.resolve(import.meta.dir, "../../skills/review-artifact/bin/review-artifact.mjs");
  const child = Bun.spawn(["node", executable, ...args], {
    env: { ...process.env, REVIEW_ARTIFACT_STATE_DIR: stateDirectory, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr, serverStarted: existsSync(stateDirectory) };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("review artifact executable", () => {
  test("prints top-level help without starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-help-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["--help"], stateDirectory)).toEqual({
      exitCode: 0,
      stdout: `Usage:
  review-artifact <html-file> [--no-open] [--reopen] [--purpose <purpose>]
  review-artifact open <html-file> [--no-open] [--reopen] [--purpose <purpose>]
  review-artifact poll <html-file> [--agent-reply <text>]
  review-artifact end <html-file>
  review-artifact stop
  review-artifact --help

Commands:
  open  Open or resume an HTML review; a direct <html-file> is shorthand for open.
  poll  Wait for feedback or approval; --agent-reply sends text before waiting.
  end   End a review without approving it.
  stop  Stop the local review server.

Defaults:
  open launches the browser unless --no-open is passed.
  purpose defaults to feedback.

Example:
  review-artifact docs/features/example/specs.html
`,
      stderr: "",
      serverStarted: false,
    });
  });

  test("prints open help without starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-open-help-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["open", "--help"], stateDirectory)).toEqual({
      exitCode: 0,
      stdout: `Usage: review-artifact open <html-file> [--no-open] [--reopen] [--purpose <purpose>]

Open or resume an HTML review.

Arguments:
  html-file  Existing .html or .htm artifact

Options:
  --no-open           Create the session without launching a browser
  --reopen            Start a new review after a prior review ended
  --purpose <purpose> Select feedback, approval, or decision
  --help              Show this help

Defaults:
  The browser opens unless --no-open is passed.
  Purpose defaults to feedback.

Example:
  review-artifact open docs/features/example/specs.html --no-open
`,
      stderr: "",
      serverStarted: false,
    });
  });

  test("prints poll help without starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-poll-help-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["poll", "--help"], stateDirectory)).toEqual({
      exitCode: 0,
      stdout: `Usage: review-artifact poll <html-file> [--agent-reply <text>]

Wait for feedback or approval on an open review.

Arguments:
  html-file             Existing reviewed .html or .htm file

Options:
  --agent-reply <text>  Send a concise reply before waiting
  --help                Show this help

Example:
  review-artifact poll docs/features/example/specs.html --agent-reply "Updated the heading"
`,
      stderr: "",
      serverStarted: false,
    });
  });

  test("prints end help without starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-end-help-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["end", "--help"], stateDirectory)).toEqual({
      exitCode: 0,
      stdout: `Usage: review-artifact end <html-file>

End an open review without approving it.

Arguments:
  html-file  Existing reviewed .html or .htm file

Options:
  --help  Show this help

Example:
  review-artifact end docs/features/example/specs.html
`,
      stderr: "",
      serverStarted: false,
    });
  });

  test("prints stop help without inspecting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-stop-help-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["stop", "--help"], stateDirectory)).toEqual({
      exitCode: 0,
      stdout: `Usage: review-artifact stop

Stop the local review server.

Options:
  --help  Show this help

Example:
  review-artifact stop
`,
      stderr: "",
      serverStarted: false,
    });
  });

  test("rejects an empty invocation with top-level usage guidance", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-empty-invocation-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact([], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: An HTML file or command is required\nRun review-artifact --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects an unknown command option before starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-unknown-option-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["open", "specs.html", "--opeen"], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: Unknown option for open: --opeen\nRun review-artifact open --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects a missing command option value before starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-missing-value-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["poll", "specs.html", "--agent-reply"], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: --agent-reply requires a value\nRun review-artifact poll --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects extra positional arguments before starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-extra-positional-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["open", "specs.html", "tasks.html"], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: open accepts exactly one HTML file\nRun review-artifact open --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects unsupported commands with top-level usage guidance", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-unsupported-command-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["approve", "specs.html"], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: Unknown command: approve\nRun review-artifact --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects an end command without an HTML file", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-end-file-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["end"], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: end accepts exactly one HTML file\nRun review-artifact end --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects options that belong to another command", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-misplaced-option-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["end", "specs.html", "--reopen"], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: Unknown option for end: --reopen\nRun review-artifact end --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects extra poll positionals before starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-poll-positionals-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["poll", "specs.html", "tasks.html"], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: poll accepts exactly one HTML file\nRun review-artifact poll --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects unknown poll options before starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-poll-option-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["poll", "specs.html", "--no-open"], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: Unknown option for poll: --no-open\nRun review-artifact poll --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects duplicate value options before starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-duplicate-option-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact([
      "poll",
      "specs.html",
      "--agent-reply",
      "First",
      "--agent-reply",
      "Second",
    ], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: --agent-reply may be provided only once\nRun review-artifact poll --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects arguments to the stop command", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-stop-argument-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["stop", "now"], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: stop accepts no arguments\nRun review-artifact stop --help for usage.\n",
      serverStarted: false,
    });
  });

  test("distinguishes an operational failure from a usage failure", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-runtime-error-"));
    const stateDirectory = path.join(directory, "state");
    expect(await runReviewArtifact(["open", "specs.html", "--no-open"], stateDirectory, {
      REVIEW_ARTIFACT_PORT: "0",
    })).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "review-artifact: REVIEW_ARTIFACT_PORT must be an integer from 1 to 65535\n",
      serverStarted: true,
    });
  });

  test("preserves direct-path shorthand and structured success output", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-process-success-"));
    const stateDirectory = path.join(directory, "state");
    const artifact = path.join(directory, "specs.html");
    const agentToken = "process-success-agent-token";
    await mkdir(stateDirectory);
    await writeFile(artifact, "<!doctype html><title>Spec</title>");
    const server = await startReviewServer({
      port: 0,
      stateFile: path.join(stateDirectory, "state.json"),
      agentToken,
    });
    servers.push(server);
    await writeFile(path.join(stateDirectory, "server.json"), JSON.stringify({ agentToken }));
    const port = new URL(server.baseUrl).port;
    const canonicalArtifact = await realpath(artifact);

    const output = await runReviewArtifact([artifact, "--no-open"], stateDirectory, {
      REVIEW_ARTIFACT_PORT: port,
    });

    expect({
      exitCode: output.exitCode,
      stderr: output.stderr,
      serverStarted: output.serverStarted,
      body: JSON.parse(output.stdout),
    }).toEqual({
      exitCode: 0,
      stderr: "",
      serverStarted: true,
      body: {
        session: {
          file: canonicalArtifact,
          url: expect.stringContaining(`${server.baseUrl}/session/`),
          status: "open",
          purpose: "feedback",
          mode: "annotate",
        },
        nextStep: `Run review-artifact poll ${canonicalArtifact} to wait for review activity.`,
      },
    });
  });
});

describe("review command", () => {
  test("opens an HTML review without launching a browser when requested", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-cli-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><title>Overnight Runner - Spec</title>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    let openedUrl = "";

    const output = await runReviewCommand([artifact, "--no-open"], {
      ensureServer: async () => server,
      openBrowser: async (url) => {
        openedUrl = url;
      },
    });

    expect(output.session).toMatchObject({ status: "open", purpose: "feedback", mode: "annotate" });
    expect(output.session.file).toEndWith("specs.html");
    expect(openedUrl).toBe("");
  });

  test("opens decision reviews with an Explore-mode purpose", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-cli-"));
    const artifact = path.join(directory, "review.html");
    await writeFile(artifact, "<!doctype html><title>Overnight Runner - Review Findings</title>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);

    const output = await runReviewCommand([artifact, "--purpose", "decision", "--no-open"], {
      ensureServer: async () => server,
    });

    expect(output.session).toMatchObject({ purpose: "decision", mode: "explore" });
  });

  test("rejects an unknown review purpose", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-cli-"));
    const artifact = path.join(directory, "review.html");
    await writeFile(artifact, "<!doctype html><title>Overnight Runner - Review Findings</title>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);

    await expect(runReviewCommand([artifact, "--purpose", "unknown", "--no-open"], {
      ensureServer: async () => server,
    })).rejects.toThrow("Unknown review purpose: unknown");
    await expect(runReviewCommand([artifact, "--purpose"], {
      ensureServer: async () => server,
    })).rejects.toThrow("Review purpose is required after --purpose");
  });

  test("returns structured feedback from the active review", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-cli-"));
    const artifact = path.join(directory, "tasks.html");
    await writeFile(artifact, "<!doctype html><title>Overnight Runner - Tasks</title>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const opened = await runReviewCommand([artifact, "--no-open"], { ensureServer: async () => server });
    const key = opened.session.url.split("/").at(-1);
    await fetch(`${server.baseUrl}/api/sessions/${key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({ prompts: [{ prompt: "Split slice two" }], domSnapshot: "main" }),
    });

    const output = await runReviewCommand(["poll", artifact], {
      ensureServer: async () => server,
      writeStatus: () => {},
    });

    expect(output).toMatchObject({ status: "feedback", prompts: [{ prompt: "Split slice two" }] });
  });

  test("poll keeps its session identity and diagnostic path when a symlink changes", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-cli-symlink-"));
    const firstArtifact = path.join(directory, "first.html");
    const secondArtifact = path.join(directory, "second.html");
    const artifactLink = path.join(directory, "review.html");
    await Promise.all([
      writeFile(firstArtifact, "<!doctype html><title>First review</title>"),
      writeFile(secondArtifact, "<!doctype html><title>Second review</title>"),
    ]);
    await symlink(firstArtifact, artifactLink);
    const requestPaths: string[] = [];
    let pollCount = 0;
    const server = Bun.serve({
      port: 0,
      async fetch(request) {
        const requestPath = new URL(request.url).pathname;
        requestPaths.push(requestPath);
        if (requestPath.endsWith("/agent-reply")) {
          await unlink(artifactLink);
          await symlink(secondArtifact, artifactLink);
          return Response.json({ status: "sent" });
        }
        pollCount += 1;
        return Response.json(pollCount === 1 ? { status: "waiting" } : { status: "approved" });
      },
    });
    servers.push({ close: async () => { await server.stop(true); } });
    const canonicalArtifact = await realpath(artifactLink);
    let diagnostic = "";

    await runReviewCommand(["poll", artifactLink, "--agent-reply", "Updated"], {
      ensureServer: async () => ({ baseUrl: server.url.origin, agentToken: "test-token" }),
      writeStatus: (message) => { diagnostic = message; },
    });

    const requestKeys = requestPaths.map((requestPath) => requestPath.split("/").at(-2));
    expect({ diagnostic, pollCount, requestKeys: new Set(requestKeys).size }).toEqual({
      diagnostic: `[review-artifact] Waiting for feedback or approval on ${canonicalArtifact}. Retry if interrupted.`,
      pollCount: 2,
      requestKeys: 1,
    });
  });

  test("ends a review without approving it", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-cli-"));
    const artifact = path.join(directory, "review.html");
    await writeFile(artifact, "<!doctype html><title>Overnight Runner - Review Findings</title>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    await runReviewCommand([artifact, "--no-open"], { ensureServer: async () => server });

    const output = await runReviewCommand(["end", artifact], { ensureServer: async () => server });

    expect(output).toEqual({ status: "ended", endedBy: "agent" });
  });
});
