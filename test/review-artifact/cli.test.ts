import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { runReviewCommand } from "../../skills/review-artifact/runtime/cli.mjs";
import { startReviewServer } from "../../skills/review-artifact/runtime/server.mjs";

const servers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
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
