import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startReviewServer } from "../../skills/review-artifact/runtime/server.mjs";
import { startFirefoxBidi } from "./firefox-bidi";

const macFirefox = "/Applications/Firefox.app/Contents/MacOS/firefox";
const firefox = Bun.which("firefox") ?? (existsSync(macFirefox) ? macFirefox : null);
if (!firefox) throw new Error("Firefox is required for review-artifact browser evidence");
const browserTest = test;
const SHELL_READY_TIMEOUT_MS = 5_000;
const SHELL_READY_POLL_MS = 50;

browserTest("completes annotations through the rendered browser surface", async () => {
  const review = await startBrowserReview({ artifactContent: annotationArtifact() });
  try {
    expect(await review.polling).toMatchObject({
      status: "feedback",
      prompts: [
        {
          prompt: "Tighten this browser-tested copy",
          selector: "html > body > main",
          tag: "main",
        },
        {
          prompt: "Rewrite the selected words",
          tag: "text",
          target: { type: "text-range", text: "Browser" },
        },
      ],
    });
  } finally {
    await closeReview(review);
  }
}, 15_000);

browserTest("submits an artifact-owned decision form through the review session", async () => {
  const review = await startInteractiveReview({ artifactContent: decisionFormArtifact() });
  try {
    await review.browser.evaluateChild(`JSON.stringify(document.querySelector("#submit-decisions").click() ?? true)`);
    expect(await review.polling).toMatchObject({
      status: "feedback",
      prompts: [{
        prompt: '{"action":"fix-selected","selectedFindingIds":["review-1"]}',
        selector: "#review-decisions",
        tag: "review-decisions",
      }],
    });
    await waitForBrowserCondition(
      () => review.browser.evaluate(`JSON.stringify((() => {
        const messages = document.querySelector("#messages").textContent;
        return messages.includes("Review decisions") && !messages.includes("fix-selected");
      })())`),
      "Decision payload remained visible in the review conversation",
    );
  } finally {
    await closeInteractiveReview(review);
  }
}, 15_000);

browserTest("bounds a live artifact feedback queue", async () => {
  const review = await startBrowserReview({ artifactContent: queueFloodArtifact() });
  try {
    const event = await review.polling;
    expect({ status: event.status, prompts: event.prompts.length }).toEqual({
      status: "feedback",
      prompts: 100,
    });
  } finally {
    await closeReview(review);
  }
}, 15_000);

browserTest("drives actual narrow shell controls through keyboard feedback", async () => {
  const review = await startInteractiveReview({
    artifactContent: "<!doctype html><main>Shell control target</main>",
    width: 480,
  });
  try {
    const controls = await review.browser.evaluate(`JSON.stringify((() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true, bubbles: true }));
      const theme = document.querySelector("#theme");
      theme.value = "dracula";
      theme.dispatchEvent(new Event("change", { bubbles: true }));
      const input = document.querySelector("#message");
      input.focus();
      const focusWorked = document.activeElement === input;
      input.value = "controls:ok";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      return {
        focusWorked,
        mode: document.querySelector("#mode").textContent,
        narrow: matchMedia("(max-width: 820px)").matches,
        presence: document.body.dataset.presence,
        theme: document.documentElement.dataset.theme,
      };
    })())`);
    expect({ controls, event: await review.polling }).toMatchObject({
      controls: {
        focusWorked: true,
        mode: "Explore",
        narrow: true,
        presence: "listening",
        theme: "dracula",
      },
      event: { status: "feedback", prompts: [{ prompt: "controls:ok", tag: "message" }] },
    });
  } finally {
    await closeInteractiveReview(review);
  }
}, 15_000);

browserTest("renders replies safely and restores scroll after actual shell reload", async () => {
  const review = await startInteractiveReview({ artifactContent: scrollArtifact("Before reload") });
  try {
    await waitForArtifactScroll(review.browser);
    await sendAgentReply(review, '<img src=x onerror="alert(1)">Safe reply');
    await writeFile(review.artifact, scrollArtifact("After reload"));
    const event = await review.polling;
    const rendering = await review.browser.evaluate(`JSON.stringify({
      containsReply: document.querySelector("#messages").textContent.includes('<img src=x onerror="alert(1)">Safe reply'),
      imageCount: document.querySelectorAll("#messages img").length,
    })`);
    expect({ event, rendering }).toMatchObject({
      event: { status: "feedback", prompts: [{ prompt: "observe:ok", tag: "message" }] },
      rendering: { containsReply: true, imageCount: 0 },
    });
  } finally {
    await closeInteractiveReview(review);
  }
}, 15_000);

browserTest("renders the actual shell without narrow horizontal overflow", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-browser-"));
  const artifact = path.join(directory, "specs.html");
  await writeFile(artifact, "<!doctype html><main>Actual narrow shell</main>");
  const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
  const created = await createSession(server, artifact);
  const browser = await startFirefoxBidi({
    executable: firefox,
    profile: path.join(directory, "firefox-profile"),
    width: 480,
    height: 900,
  });

  try {
    await browser.navigate(created.url);
    expect(await browser.evaluate(narrowLayoutExpression())).toEqual({
      bodyScrollable: true,
      narrow: true,
      noHorizontalOverflow: true,
      regionsVisible: true,
    });
  } finally {
    await browser.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

browserTest("survives malformed durable chat on actual shell reload", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-browser-"));
  const artifact = path.join(directory, "specs.html");
  const stateFile = path.join(directory, "state.json");
  await writeFile(artifact, "<!doctype html><main>Durable chat</main>");
  let server = await startReviewServer({ port: 0, stateFile });
  const created = await createSession(server, artifact);
  await server.close();
  const state = JSON.parse(await readFile(stateFile, "utf8"));
  state.sessions[created.key].chat = [
    { role: "agent", text: "Safe durable reply" },
    { role: "user", text: "Malformed", prompt: { target: { type: "text-range", text: {} } } },
  ];
  await writeFile(stateFile, JSON.stringify(state));
  server = await startReviewServer({ port: 0, stateFile });
  const reopened = await createSession(server, artifact);
  const browser = await startFirefoxBidi({
    executable: firefox,
    profile: path.join(directory, "firefox-profile"),
    width: 960,
    height: 900,
  });

  try {
    await browser.navigate(reopened.url);
    expect(await browser.evaluate(`JSON.stringify({
      messages: document.querySelector("#messages").textContent,
      sendVisible: document.querySelector("#send").getBoundingClientRect().width > 0,
    })`)).toEqual({ messages: "AgentSafe durable reply", sendVisible: true });
  } finally {
    await browser.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);

browserTest("keeps browser approval distinct from ending review", async () => {
  expect([
    await runShellDecision("approve"),
    await runShellDecision("end"),
  ]).toEqual([
    { status: "approved", endedBy: "user" },
    { status: "ended", endedBy: "user" },
  ]);
}, 30_000);

async function startBrowserReview({ artifactContent }: { artifactContent: string }) {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-browser-"));
  const artifact = path.join(directory, "specs.html");
  await writeFile(artifact, artifactContent);
  const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
  const created = await createSession(server, artifact);
  const polling = pollForAgentEvent(server, created.key);
  const browser = spawnFirefox(directory, created.url);
  return { artifact, browser, directory, key: created.key, polling, server };
}

async function startInteractiveReview({
  artifactContent,
  width = 960,
}: {
  artifactContent: string;
  width?: number;
}) {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-browser-"));
  const artifact = path.join(directory, "specs.html");
  await writeFile(artifact, artifactContent);
  const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
  const created = await createSession(server, artifact);
  const polling = pollForAgentEvent(server, created.key);
  const browser = await startFirefoxBidi({
    executable: firefox,
    profile: path.join(directory, "firefox-profile"),
    width,
    height: 900,
  });
  await browser.navigate(created.url);
  await waitForShellListening(browser);
  return { artifact, browser, directory, key: created.key, polling, server };
}

async function waitForShellListening(browser: Awaited<ReturnType<typeof startFirefoxBidi>>) {
  await waitForBrowserCondition(
    () => browser.evaluate(`JSON.stringify(document.body.dataset.presence === "listening")`),
    "Review shell event stream did not become ready",
  );
}

async function waitForArtifactScroll(browser: Awaited<ReturnType<typeof startFirefoxBidi>>) {
  await waitForBrowserCondition(
    () => browser.evaluateChild(`JSON.stringify(scrollY >= 350)`),
    "Reviewed artifact did not reach its initial scroll position",
  );
}

async function waitForBrowserCondition(check: () => Promise<boolean>, failure: string) {
  const deadline = Date.now() + SHELL_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(SHELL_READY_POLL_MS);
  }
  throw new Error(failure);
}

async function createSession(server: { baseUrl: string }, artifact: string) {
  return fetch(`${server.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: artifact }),
  }).then((response) => response.json());
}

function pollForAgentEvent(server: { agentToken: string; baseUrl: string }, key: string) {
  return fetch(`${server.baseUrl}/api/sessions/${key}/poll`, {
    headers: { "x-review-artifact-agent-token": server.agentToken },
    signal: AbortSignal.timeout(10_000),
  }).then((response) => response.json());
}

function spawnFirefox(directory: string, targetUrl: string) {
  return spawn(firefox, [
    "--headless", "--no-remote", "--profile", path.join(directory, "firefox-profile"), targetUrl,
  ], { stdio: "ignore" });
}

async function sendAgentReply(review: { key: string; server: { agentToken: string; baseUrl: string } }, text: string) {
  await fetch(`${review.server.baseUrl}/api/sessions/${review.key}/agent-reply`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-review-artifact-agent-token": review.server.agentToken,
    },
    body: JSON.stringify({ text }),
  });
}

async function runShellDecision(action: "approve" | "end") {
  const review = await startInteractiveReview({
    artifactContent: "<!doctype html><main>Decision target</main>",
  });
  try {
    await review.browser.evaluate(`JSON.stringify(document.querySelector(${JSON.stringify(`#${action}`)}).click() ?? true)`);
    return await review.polling;
  } finally {
    await closeInteractiveReview(review);
  }
}

async function closeReview(review: Awaited<ReturnType<typeof startBrowserReview>>) {
  await stopBrowser(review.browser);
  await review.server.close();
  await rm(review.directory, { recursive: true, force: true });
}

async function closeInteractiveReview(review: Awaited<ReturnType<typeof startInteractiveReview>>) {
  await review.browser.close();
  await review.server.close();
  await rm(review.directory, { recursive: true, force: true });
}

async function stopBrowser(browser: ReturnType<typeof spawn>) {
  if (browser.exitCode !== null) return;
  browser.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => browser.once("close", () => resolve())),
    Bun.sleep(2_000),
  ]);
  if (browser.exitCode === null) browser.kill("SIGKILL");
}

function narrowLayoutExpression() {
  return `JSON.stringify((() => {
    const selectors = [".artifact-panel", ".conversation", "#message", ".actions"];
    const regionsVisible = selectors.every((selector) => {
      const element = document.querySelector(selector);
      const rect = element?.getBoundingClientRect();
      return rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth + 1;
    });
    return {
      bodyScrollable: getComputedStyle(document.body).overflowY === "auto",
      narrow: matchMedia("(max-width: 820px)").matches && innerWidth <= 480,
      noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
      regionsVisible,
    };
  })())`;
}

function annotationArtifact() {
  return `<!doctype html><html><body><main tabindex="-1">Browser review target</main>
<script>
window.addEventListener("load", () => setTimeout(() => {
  parent.postMessage({ type: "review:queue", prompt: null }, "*");
  const target = document.querySelector("main");
  target.focus();
  target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  setTimeout(() => {
    const input = document.querySelector('[data-review-artifact-ui="card"] textarea');
    if (!input || document.activeElement !== input) return;
    input.value = "Tighten this browser-tested copy";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    setTimeout(() => selectText(target), 100);
  }, 150);
}, 300));
function selectText(target) {
  const range = document.createRange();
  range.setStart(target.firstChild, 0);
  range.setEnd(target.firstChild, 7);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  setTimeout(() => {
    const input = document.querySelector('[data-review-artifact-ui="card"] textarea');
    if (!input || document.activeElement !== input) return;
    input.value = "Rewrite the selected words";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    setTimeout(() => parent.postMessage({
      type: "review:snapshot", snapshot: 'main "Browser review target"',
    }, "*"), 100);
  }, 150);
}
</script></body></html>`;
}

function decisionFormArtifact() {
  return `<!doctype html><form id="review-decisions">
<button id="submit-decisions" type="submit">Submit decisions</button></form><script>
document.querySelector("#review-decisions").addEventListener("submit", (event) => {
  event.preventDefault();
  parent.postMessage({
    type: "review:submit",
    prompt: {
      prompt: '{"action":"fix-selected","selectedFindingIds":["review-1"]}',
      selector: "#review-decisions",
      tag: "review-decisions",
      text: "Review decisions",
    },
  }, "*");
});
</script>`;
}

function queueFloodArtifact() {
  return `<!doctype html><main>Queue target</main><script>
window.addEventListener("load", () => setTimeout(() => {
  for (let index = 0; index < 101; index += 1) {
    parent.postMessage({
      type: "review:queue",
      prompt: { prompt: "Queued " + index, selector: "main", tag: "main", text: "Queue target" },
    }, "*");
  }
  setTimeout(() => parent.postMessage({ type: "review:snapshot", snapshot: "main" }, "*"), 100);
}, 300));
</script>`;
}

function scrollArtifact(label: string) {
  return `<!doctype html><style>body{height:2400px}</style><main>${label}</main>
<script>
window.addEventListener("load", () => setTimeout(() => {
  const reload = new URL(location.href).searchParams.has("reload");
  if (!reload) {
    scrollTo(0, 400);
    return;
  }
  const observer = setInterval(() => {
    if (scrollY < 350) return;
    clearInterval(observer);
    parent.postMessage({
      type: "review:queue",
      prompt: { prompt: "observe:ok", selector: "main", tag: "message", text: "After reload" },
    }, "*");
    parent.postMessage({ type: "review:snapshot", snapshot: "restored" }, "*");
  }, 50);
}, 100));
</script>`;
}
