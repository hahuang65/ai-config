import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startReviewServer } from "../../skills/review-artifact/runtime/server.mjs";

const servers: Array<{ agentToken: string; close(): Promise<void> }> = [];

function agentHeaders(server: { agentToken: string }) {
  return { "x-review-artifact-agent-token": server.agentToken };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("review server", () => {
  test("identifies the local runtime through its health endpoint", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);

    const response = await fetch(`${server.baseUrl}/health`);

    expect(await response.json()).toEqual({ ok: true, app: "review-artifact", version: 5 });
  });

  test("opens a local HTML artifact without modifying its source", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    const source = "<!doctype html><html><body><main>Review me</main></body></html>";
    await writeFile(artifact, source);

    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);

    const response = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    });
    const session = await response.json();

    expect(response.status).toBe(201);
    expect(session.file).toBe(await realpath(artifact));
    expect(session.status).toBe("open");
    expect(session.url).toContain("/session/");
    expect(await Bun.file(artifact).text()).toBe(source);
  });

  test("delivers browser feedback through the agent poll", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Review me</main>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());

    await fetch(`${server.baseUrl}/api/sessions/${created.key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({
        prompts: [{ prompt: "Cut this", selector: "main", tag: "main", text: "Review me" }],
        domSnapshot: 'main "Review me"',
      }),
    });
    const event = await fetch(`${server.baseUrl}/api/sessions/${created.key}/poll`, {
      headers: agentHeaders(server),
    }).then((response) => response.json());

    expect(event).toMatchObject({ status: "feedback", prompts: [{ prompt: "Cut this", selector: "main" }] });
  });

  test("keeps a foreground poll open until later feedback arrives", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Wait here</main>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());

    const polling = fetch(`${server.baseUrl}/api/sessions/${created.key}/poll`, {
      headers: agentHeaders(server),
    }).then((response) => response.json());
    await Bun.sleep(100);
    await fetch(`${server.baseUrl}/api/sessions/${created.key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({ prompts: [{ prompt: "Arrived later" }] }),
    });

    expect(await polling).toMatchObject({ status: "feedback", prompts: [{ prompt: "Arrived later" }] });
  });

  test("renews a quiet foreground poll before the HTTP client timeout", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Keep waiting</main>");
    const server = await startReviewServer({
      port: 0,
      stateFile: path.join(directory, "state.json"),
      pollWaitMs: 20,
    });
    servers.push(server);
    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());

    const event = await fetch(`${server.baseUrl}/api/sessions/${created.key}/poll`, {
      headers: agentHeaders(server),
      signal: AbortSignal.timeout(200),
    }).then((response) => response.json());

    expect(event).toEqual({ status: "waiting" });
  });

  test("reports browser approval as a structured terminal event", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Approve me</main>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());

    await fetch(`${server.baseUrl}/api/sessions/${created.key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({ prompts: [], domSnapshot: "main", action: "approve" }),
    });
    const decision = await fetch(`${server.baseUrl}/api/sessions/${created.key}/poll`, {
      headers: agentHeaders(server),
    }).then((response) => response.json());

    expect(decision).toEqual({ status: "approved", endedBy: "user" });
  });

  test("delivers proven severe layout warnings through the agent poll", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Wide</main>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());

    await fetch(`${server.baseUrl}/api/sessions/${created.key}/layout-warnings`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({
        layoutWarnings: [{ selector: "main", kind: "escaped-content", axis: "horizontal", overflowPx: 120, viewportWidth: 800, severity: "error" }],
      }),
    });
    const event = await fetch(`${server.baseUrl}/api/sessions/${created.key}/poll`, {
      headers: agentHeaders(server),
    }).then((response) => response.json());

    expect(event).toMatchObject({ status: "layout_warnings", layoutWarnings: [{ selector: "main", severity: "error" }] });
  });

  test("does not reopen a review the user already approved", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Approved</main>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const create = () => fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());
    const opened = await create();
    await fetch(`${server.baseUrl}/api/sessions/${opened.key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: server.baseUrl },
      body: JSON.stringify({ prompts: [], action: "approve" }),
    });

    const reopened = await create();

    expect(reopened.status).toBe("approved");
    expect(reopened.reopened).toBe(false);
  });

  test("shows an agent reply in the review conversation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Reply here</main>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());

    await fetch(`${server.baseUrl}/api/sessions/${created.key}/agent-reply`, {
      method: "POST",
      headers: { "content-type": "application/json", ...agentHeaders(server) },
      body: JSON.stringify({ text: "Updated the scope." }),
    });
    const shell = await fetch(created.url).then((response) => response.text());

    expect(shell).toContain("Updated the scope.");
  });

  test("streams a reload event when the reviewed artifact changes", async () => {
    const received = await observeReloadAfter(async (artifact) => {
      await writeFile(artifact, "<!doctype html><main>Complete</main>");
    });

    expect(received).toContain('"type":"reload"');
  });

  test("streams a reload event when the artifact is atomically replaced", async () => {
    const received = await observeReloadAfter(async (artifact) => {
      const replacement = `${artifact}.replacement`;
      await writeFile(replacement, "<!doctype html><main>Replaced</main>");
      await rename(replacement, artifact);
    });

    expect(received).toContain('"type":"reload"');
  });

  test("exposes agent presence as an accessible live status", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Presence</main>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());

    const shell = await fetch(created.url).then((response) => response.text());

    expect(shell).toContain('id="presence"');
    expect(shell).toContain('aria-live="polite"');
  });

  test("defaults to Catppuccin Mocha and offers persistent theme choices", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Theme me</main>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());

    const [shell, shellClient, shellCss] = await Promise.all([
      fetch(created.url).then((response) => response.text()),
      fetch(`${server.baseUrl}/shell.js`).then((response) => response.text()),
      fetch(`${server.baseUrl}/shell.css`).then((response) => response.text()),
    ]);

    expect(shell).toContain('<select id="theme"');
    expect(shell).toContain('<option value="catppuccin-mocha" selected>Catppuccin Mocha</option>');
    expect(shell).toContain('<option value="dracula">Dracula</option>');
    expect(shell).toContain('<option value="nord">Nord</option>');
    expect(shell).toContain('<option value="tokyo-night">Tokyo Night</option>');
    expect(shell).toContain('<option value="gruvbox-dark">Gruvbox Dark</option>');
    expect(shellCss).toContain(':root[data-theme="catppuccin-mocha"]');
    expect(shellCss).toContain(':root[data-theme="catppuccin-latte"]');
    expect(shellClient).toContain('localStorage.getItem(themeStorageKey)');
    expect(shellClient).toContain('document.documentElement.dataset.theme');
  });

  test("serves the browser assets used by the review shell and artifact bridge", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);

    const [bridge, messageValidation, shellClient, shellCss] = await Promise.all([
      fetch(`${server.baseUrl}/bridge.js`).then((response) => response.text()),
      fetch(`${server.baseUrl}/message-validation.js`).then((response) => response.text()),
      fetch(`${server.baseUrl}/shell.js`).then((response) => response.text()),
      fetch(`${server.baseUrl}/shell.css`).then((response) => response.text()),
    ]);

    expect(bridge).toContain("review:queue");
    expect(messageValidation).toContain("validateFrameMessage");
    expect(shellClient).toContain("feedback");
    expect(shellCss).toContain(".conversation");
  });

  test("keeps the desktop panes bounded while scaling the conversation width", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);

    const shellCss = await fetch(`${server.baseUrl}/shell.css`).then((response) => response.text());

    expect(shellCss).toContain("grid-template-columns: minmax(0, 1fr) clamp(300px, 32vw, 520px)");
    expect(shellCss).toContain("grid-template-rows: minmax(0, 1fr)");
    expect(shellCss).toContain("#messages { min-height: 0; overflow-y: auto");
  });

  test("links annotation messages to artifact elements through the locate protocol", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);

    const [bridge, shellClient] = await Promise.all([
      fetch(`${server.baseUrl}/bridge.js`).then((response) => response.text()),
      fetch(`${server.baseUrl}/shell.js`).then((response) => response.text()),
    ]);

    expect(shellClient).toContain("annotation-badge");
    expect(shellClient).toContain('type: "review:locate"');
    expect(bridge).toContain('type === "review:locate"');
    expect(bridge).toContain("review:locate-result");
  });

  test("serves sibling assets while confining reads to the artifact directory", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifactDirectory = path.join(directory, "artifact");
    await mkdir(artifactDirectory);
    const artifact = path.join(artifactDirectory, "index.html");
    await writeFile(artifact, '<!doctype html><link rel="stylesheet" href="theme.css">');
    await writeFile(path.join(artifactDirectory, "theme.css"), "main { color: green; }");
    await writeFile(path.join(artifactDirectory, "details.html"), "<!doctype html><main>Details</main>");
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);
    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());

    const allowed = await fetch(`${server.baseUrl}/artifact/${created.key}/theme.css`);
    const siblingHtml = await fetch(`${server.baseUrl}/artifact/${created.key}/details.html`);
    const escaped = await fetch(`${server.baseUrl}/artifact/${created.key}/%2e%2e/state.json`);

    expect(await allowed.text()).toBe("main { color: green; }");
    expect(siblingHtml.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(escaped.status).toBe(404);
  });

  test("serves the artifact inside a sandboxed review shell", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
    const artifact = path.join(directory, "tasks.html");
    const source = "<!doctype html><html><body><main>Six slices</main></body></html>";
    await writeFile(artifact, source);
    const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    servers.push(server);

    const created = await fetch(`${server.baseUrl}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file: artifact }),
    }).then((response) => response.json());
    const shell = await fetch(created.url).then((response) => response.text());
    const servedArtifact = await fetch(`${server.baseUrl}/artifact/${created.key}/index.html`).then((response) =>
      response.text(),
    );

    expect(shell).toContain('sandbox="allow-scripts allow-forms"');
    expect(shell).toContain(`/artifact/${created.key}/index.html`);
    expect(servedArtifact).toContain("Six slices");
    expect(servedArtifact).toContain(`/bridge.js?key=${created.key}`);
    expect(await Bun.file(artifact).text()).toBe(source);
  });
});

async function observeReloadAfter(changeArtifact: (artifact: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-"));
  const artifact = path.join(directory, "tasks.html");
  await writeFile(artifact, "<!doctype html><main>Pending</main>");
  const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
  servers.push(server);
  const created = await fetch(`${server.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: artifact }),
  }).then((response) => response.json());
  const controller = new AbortController();
  const stream = await fetch(`${server.baseUrl}/api/sessions/${created.key}/events`, { signal: controller.signal });
  const reader = stream.body!.getReader();

  try {
    await Bun.sleep(100);
    await changeArtifact(artifact);
    let received = "";
    const deadline = Date.now() + 2_000;
    while (!received.includes('"type":"reload"') && Date.now() < deadline) {
      const chunk = await Promise.race([
        reader.read(),
        Bun.sleep(2_000).then(() => ({ done: true, value: undefined })),
      ]);
      if (chunk.done) break;
      received += new TextDecoder().decode(chunk.value);
    }
    return received;
  } finally {
    controller.abort();
  }
}
