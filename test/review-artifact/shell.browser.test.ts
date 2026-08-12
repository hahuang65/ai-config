import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startReviewServer } from "../../skills/review-artifact/runtime/server.mjs";
import {
  annotationArtifact,
  decisionFormArtifact,
  narrowLayoutExpression,
  queueFloodArtifact,
  scrollArtifact,
} from "./browser-fixtures";
import { createConcurrencyLimit } from "../concurrency-limit";
import { startFirefoxBidiPool } from "./firefox-bidi";

const macFirefox = "/Applications/Firefox.app/Contents/MacOS/firefox";
const firefox = Bun.which("firefox") ?? (existsSync(macFirefox) ? macFirefox : null);
if (!firefox) throw new Error("Firefox is required for review-artifact browser evidence");
const BROWSER_TEST_TIMEOUT_MS = 30_000;
const MAX_BROWSER_CONTEXTS = 3;
const withBrowserSlot = createConcurrencyLimit(MAX_BROWSER_CONTEXTS);
const browserTest = (name: string, body: () => Promise<void>, timeout = BROWSER_TEST_TIMEOUT_MS) =>
  test.concurrent(name, () => withBrowserSlot(body), Math.max(timeout, BROWSER_TEST_TIMEOUT_MS));
const multiContextBrowserTest = (name: string, body: () => Promise<void>, timeout = BROWSER_TEST_TIMEOUT_MS) =>
  test.concurrent(name, () => withBrowserSlot(body, 2), Math.max(timeout, BROWSER_TEST_TIMEOUT_MS));
const exclusiveBrowserTest = (name: string, body: () => Promise<void>, timeout = BROWSER_TEST_TIMEOUT_MS) =>
  test.concurrent(
    name,
    () => withBrowserSlot(body, MAX_BROWSER_CONTEXTS),
    Math.max(timeout, BROWSER_TEST_TIMEOUT_MS),
  );
const SHELL_READY_TIMEOUT_MS = 5_000;
const SHELL_READY_POLL_MS = 50;
const AGENT_EVENT_TIMEOUT_MS = 20_000;
let browserPool: Awaited<ReturnType<typeof startFirefoxBidiPool>>;
let browserPoolDirectory: string;

beforeAll(async () => {
  browserPoolDirectory = await mkdtemp(path.join(tmpdir(), "review-artifact-firefox-pool-"));
  browserPool = await startFirefoxBidiPool({
    executable: firefox,
    profile: path.join(browserPoolDirectory, "firefox-profile"),
  });
}, BROWSER_TEST_TIMEOUT_MS);

afterAll(async () => {
  try {
    await browserPool?.close();
  } finally {
    await rm(browserPoolDirectory, { recursive: true, force: true });
  }
}, BROWSER_TEST_TIMEOUT_MS);

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

multiContextBrowserTest("isolates persisted state between pooled browser contexts", async () => {
  const review = await startInteractiveReview({ artifactContent: decisionFormArtifact() });
  void review.polling.catch(() => {});
  let secondContext: Awaited<ReturnType<typeof browserPool.createContext>> | undefined;
  try {
    secondContext = await browserPool.createContext({ width: 1280, height: 900 });
    const secondSession = await createSession(review.server, review.artifact);
    await secondContext.navigate(secondSession.url);
    await waitForShellListening(secondContext);
    await review.browser.evaluate(`JSON.stringify(localStorage.setItem("pool-isolation", "first") ?? true)`);
    expect(await secondContext.evaluate(`JSON.stringify(localStorage.getItem("pool-isolation"))`)).toBeNull();
  } finally {
    const results = await Promise.allSettled([
      secondContext?.close(),
      closeInteractiveReview(review),
    ]);
    throwCleanupFailures(results, "Browser isolation cleanup failed");
  }
});

browserTest("starts decision forms in Explore mode with the artifact document title", async () => {
  const review = await startInteractiveReview({ artifactContent: decisionFormArtifact(), purpose: "decision" });
  try {
    await waitForBrowserCondition(
      () => review.browser.evaluate(`JSON.stringify(document.title === "Overnight Runner - Review Findings")`),
      "Review shell did not adopt the artifact document title",
    );
    expect(await review.browser.evaluate(`JSON.stringify({
      mode: document.querySelector("#mode").textContent,
      pressed: document.querySelector("#mode").getAttribute("aria-pressed"),
      title: document.title,
    })`)).toEqual({
      mode: "Explore",
      pressed: "false",
      title: "Overnight Runner - Review Findings",
    });
    expect(await review.browser.evaluateChild(`JSON.stringify((() => {
      document.querySelector("#explore-target").click();
      return document.body.dataset.explored;
    })())`)).toBe("yes");
    await review.browser.evaluateChild(`JSON.stringify(document.querySelector("#submit-decisions").click() ?? true)`);
    const feedback = await review.polling;
    const completion = await pollForAgentEvent(review.server, review.key);
    await waitForBrowserCondition(
      () => review.browser.evaluate(`JSON.stringify(document.body.dataset.session === "ended")`),
      "Submitted decisions did not show the completed-review splash",
    );
    expect({ feedback, completion }).toMatchObject({
      feedback: {
        status: "feedback",
        prompts: [{
          prompt: '{"action":"fix-selected","selectedFindingIds":["review-1"]}',
          selector: "#review-decisions",
          tag: "review-decisions",
        }],
      },
      completion: { status: "ended", endedBy: "user" },
    });
    expect(await review.browser.evaluate(`JSON.stringify((() => {
      const messages = document.querySelector("#messages").textContent;
      return {
        decisionsVisible: messages.includes("Review decisions") && !messages.includes("fix-selected"),
        splash: getComputedStyle(document.body, "::after").content,
      };
    })())`)).toEqual({
      decisionsVisible: true,
      splash: '"Review ended without approval. Return to your agent."',
    });
  } finally {
    await closeInteractiveReview(review);
  }
}, 15_000);

browserTest("completes an approve-as-is form submission as browser approval", async () => {
  const review = await startInteractiveReview({
    artifactContent: decisionFormArtifact("approve"),
    purpose: "decision",
  });
  try {
    await review.browser.evaluateChild(`JSON.stringify(document.querySelector("#submit-decisions").click() ?? true)`);
    const feedback = await review.polling;
    const completion = await pollForAgentEvent(review.server, review.key);
    await waitForBrowserCondition(
      () => review.browser.evaluate(`JSON.stringify(document.body.dataset.session === "approved")`),
      "Approve-as-is submission did not show the approved-review splash",
    );
    expect({ feedback, completion }).toMatchObject({
      feedback: {
        status: "feedback",
        prompts: [{ prompt: '{"action":"approve-as-is","selectedFindingIds":[]}' }],
      },
      completion: { status: "approved", endedBy: "user" },
    });
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

browserTest("shows the layout gate only for reported failures and allows dismissal", async () => {
  const review = await startInteractiveReview({
    artifactContent: `<!doctype html><main>Layout gate target</main><script>
      setTimeout(() => parent.postMessage({
        type: "review:layout",
        layoutWarnings: [{
          selector: "main",
          kind: "escaped-content",
          axis: "horizontal",
          overflowPx: 48,
          viewportWidth: innerWidth,
          severity: "error",
          persistent: false,
        }],
      }, "*"), 1_000);
    </script>`,
  });
  void review.polling.catch(() => {});
  try {
    expect(await review.browser.evaluate(`JSON.stringify(document.querySelector("#layout-gate").hidden)`)).toBeTrue();
    await waitForBrowserCondition(
      () => review.browser.evaluate(`JSON.stringify(!document.querySelector("#layout-gate").hidden)`),
      "Layout gate did not appear for a reported failure",
    );
    expect(await review.browser.evaluate(`JSON.stringify((() => {
      const button = document.querySelector("#show-anyway");
      button.click();
      return document.querySelector("#layout-gate").hidden;
    })())`)).toBeTrue();
  } finally {
    await closeInteractiveReview(review);
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

exclusiveBrowserTest("renders replies safely and restores scroll after actual shell reload", async () => {
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
  let browser: BrowserContext | undefined;
  let server: Awaited<ReturnType<typeof startReviewServer>> | undefined;
  try {
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, "<!doctype html><main>Actual narrow shell</main>");
    server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    const created = await createSession(server, artifact);
    browser = await createBrowserContext(480);
    await browser.navigate(created.url);
    expect(await browser.evaluate(narrowLayoutExpression())).toEqual({
      bodyScrollable: true,
      narrow: true,
      noHorizontalOverflow: true,
      regionsVisible: true,
    });
  } finally {
    await cleanupReviewResources({ browser, directory, server }, true);
  }
}, 15_000);

browserTest("survives malformed durable chat on actual shell reload", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-browser-"));
  let browser: BrowserContext | undefined;
  let server: Awaited<ReturnType<typeof startReviewServer>> | undefined;
  try {
    const artifact = path.join(directory, "specs.html");
    const stateFile = path.join(directory, "state.json");
    await writeFile(artifact, "<!doctype html><main>Durable chat</main>");
    server = await startReviewServer({ port: 0, stateFile });
    const created = await createSession(server, artifact);
    await server.close();
    server = undefined;
    const state = JSON.parse(await readFile(stateFile, "utf8"));
    state.sessions[created.key].chat = [
      { role: "agent", text: "Safe durable reply" },
      { role: "user", text: "Malformed", prompt: { target: { type: "text-range", text: {} } } },
    ];
    await writeFile(stateFile, JSON.stringify(state));
    server = await startReviewServer({ port: 0, stateFile });
    const reopened = await createSession(server, artifact);
    browser = await createBrowserContext();
    await browser.navigate(reopened.url);
    expect(await browser.evaluate(`JSON.stringify({
      messages: document.querySelector("#messages").textContent,
      sendVisible: document.querySelector("#send").getBoundingClientRect().width > 0,
    })`)).toEqual({ messages: "AgentSafe durable reply", sendVisible: true });
  } finally {
    await cleanupReviewResources({ browser, directory, server }, true);
  }
}, 15_000);

multiContextBrowserTest("keeps browser approval distinct from ending review", async () => {
  expect(await Promise.all([
    runShellDecision("approve"),
    runShellDecision("end"),
  ])).toEqual([
    { status: "approved", endedBy: "user" },
    { status: "ended", endedBy: "user" },
  ]);
}, 30_000);

async function startBrowserReview({ artifactContent }: { artifactContent: string }) {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-browser-"));
  let browser: BrowserContext | undefined;
  let polling: ReturnType<typeof pollForAgentEvent> | undefined;
  let server: Awaited<ReturnType<typeof startReviewServer>> | undefined;
  const pollController = new AbortController();
  try {
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, artifactContent);
    server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    const created = await createSession(server, artifact);
    polling = pollForAgentEvent(server, created.key, pollController.signal);
    browser = await createBrowserContext();
    await browser.navigate(created.url);
    return { artifact, browser, directory, key: created.key, pollController, polling, server };
  } catch (error) {
    void polling?.catch(() => {});
    await cleanupReviewResources({ browser, directory, pollController, server });
    throw error;
  }
}

async function startInteractiveReview({
  artifactContent,
  purpose = "feedback",
  width = 960,
}: {
  artifactContent: string;
  purpose?: "feedback" | "approval" | "decision";
  width?: number;
}) {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-browser-"));
  let browser: BrowserContext | undefined;
  let polling: ReturnType<typeof pollForAgentEvent> | undefined;
  let server: Awaited<ReturnType<typeof startReviewServer>> | undefined;
  const pollController = new AbortController();
  try {
    const artifact = path.join(directory, "specs.html");
    await writeFile(artifact, artifactContent);
    server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
    const created = await createSession(server, artifact, purpose);
    polling = pollForAgentEvent(server, created.key, pollController.signal);
    browser = await createBrowserContext(width);
    await browser.navigate(created.url);
    await waitForShellListening(browser);
    return { artifact, browser, directory, key: created.key, pollController, polling, server };
  } catch (error) {
    void polling?.catch(() => {});
    await cleanupReviewResources({ browser, directory, pollController, server });
    throw error;
  }
}

function createBrowserContext(width = 960) {
  return browserPool.createContext({ width, height: 900 });
}

type BrowserContext = Awaited<ReturnType<typeof createBrowserContext>>;

async function waitForShellListening(browser: BrowserContext) {
  await waitForBrowserCondition(
    () => browser.evaluate(`JSON.stringify(document.body.dataset.presence === "listening")`),
    "Review shell event stream did not become ready",
  );
}

async function waitForArtifactScroll(browser: BrowserContext) {
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

async function createSession(
  server: { baseUrl: string },
  artifact: string,
  purpose: "feedback" | "approval" | "decision" = "feedback",
) {
  return fetch(`${server.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: artifact, purpose }),
  }).then((response) => response.json());
}

function pollForAgentEvent(
  server: { agentToken: string; baseUrl: string },
  key: string,
  signal?: AbortSignal,
) {
  const timeout = AbortSignal.timeout(AGENT_EVENT_TIMEOUT_MS);
  return fetch(`${server.baseUrl}/api/sessions/${key}/poll`, {
    headers: { "x-review-artifact-agent-token": server.agentToken },
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  }).then((response) => response.json());
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
  await cleanupReviewResources(review, true);
}

async function closeInteractiveReview(review: Awaited<ReturnType<typeof startInteractiveReview>>) {
  await cleanupReviewResources(review, true);
}

async function cleanupReviewResources(
  resources: {
    browser?: BrowserContext;
    directory: string;
    pollController?: AbortController;
    server?: Awaited<ReturnType<typeof startReviewServer>>;
  },
  reportFailure = false,
) {
  resources.pollController?.abort();
  const closeResults = await Promise.allSettled([
    resources.browser?.close(),
    resources.server?.close(),
  ]);
  const removeResults = await Promise.allSettled([
    rm(resources.directory, { recursive: true, force: true }),
  ]);
  if (reportFailure) {
    throwCleanupFailures([...closeResults, ...removeResults], "Review browser cleanup failed");
  }
}

function throwCleanupFailures(results: PromiseSettledResult<unknown>[], message: string) {
  const failures = results
    .filter((result): result is PromiseRejectedResult => result.status === "rejected")
    .map((result) => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, message);
}
