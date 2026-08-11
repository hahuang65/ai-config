import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startReviewServer } from "../../skills/review-artifact/runtime/server.mjs";
import { startFirefoxBidiPool } from "./firefox-bidi";

const CONDITION_TIMEOUT_MS = 5_000;
export type BrowserPool = Awaited<ReturnType<typeof startFirefoxBidiPool>>;
export type BrowserContext = Awaited<ReturnType<BrowserPool["createContext"]>>;
export type ChangeReview = Awaited<ReturnType<typeof startChangeReviewFromHtml>>;

export async function startChangeReviewFromHtml(browserPool: BrowserPool, html: string, width = 960, height = 900) {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-change-"));
  const artifact = path.join(directory, "specs.html");
  const pollController = new AbortController();
  await writeFile(artifact, html);
  const server = await startReviewServer({ port: 0, stateFile: path.join(directory, "state.json") });
  const session = await createSession(server, artifact);
  void pollForAgentEvent(server, session.key, pollController.signal).catch(() => {});
  const browser = await browserPool.createContext({ width, height });
  await browser.navigate(session.url);
  await waitForListening(browser);
  await waitForRevisionReady(browser);
  return { artifact, browser, directory, pollController, server, url: session.url };
}

export async function closeChangeReview(review: ChangeReview) {
  review.pollController.abort();
  await Promise.allSettled([
    review.browser.close(),
    review.server.close(),
    rm(review.directory, { recursive: true, force: true }),
  ]);
}

export async function readChangeSurface(browser: BrowserContext) {
  const shell = await browser.evaluate(`JSON.stringify((() => {
    const bar = document.querySelector("[data-review-change-bar]");
    return {
      changeBarVisible: Boolean(bar && !bar.hidden),
      count: document.querySelector("[data-review-change-count]")?.textContent || "",
    };
  })())`) as { changeBarVisible: boolean; count: string };
  const regions = await browser.evaluateChild(`JSON.stringify(
    [...document.querySelectorAll("[data-review-artifact-change]")].map((region) => ({
      kind: region.dataset.reviewArtifactChange,
      target: region.dataset.reviewArtifactTarget,
    }))
  )`) as Array<{ kind: string; target: string }>;
  return { ...shell, regions };
}

export function clickChangeControl(
  browser: BrowserContext,
  action: "next" | "previous" | "dismiss",
) {
  return browser.evaluate(`JSON.stringify((() => {
    const control = document.querySelector('[data-review-change-action="${action}"]');
    if (!control) return false;
    control.click();
    return true;
  })())`) as Promise<boolean>;
}

export async function waitForActiveTarget(browser: BrowserContext, target: string) {
  await waitForCondition(
    () => readNavigationSurface(browser).then((surface) => surface.activeTargets.join() === target),
    `Changed-region navigation did not activate ${target}`,
  );
}

export function readNavigationSurface(browser: BrowserContext) {
  return browser.evaluateChild(`JSON.stringify((() => {
    const first = document.querySelector("#first-change").getBoundingClientRect();
    return {
      activeTargets: [...document.querySelectorAll("[data-review-change-active]")]
        .map((region) => region.dataset.reviewArtifactTarget),
      visibleTargets: [...document.querySelectorAll("[data-review-artifact-change]")]
        .filter((region) => getComputedStyle(region).opacity !== "0")
        .map((region) => region.dataset.reviewArtifactTarget),
      firstVisible: first.top >= 0 && first.bottom <= innerHeight,
      scrollY,
    };
  })())`) as Promise<{ activeTargets: string[]; visibleTargets: string[]; firstVisible: boolean; scrollY: number }>;
}

export async function waitForRevisionReload(browser: BrowserContext) {
  await waitForRevisionReloadStart(browser);
  await waitForRevisionReady(browser);
}

export async function waitForRevisionReloadStart(browser: BrowserContext) {
  await waitForCondition(
    () => browser.evaluate(`JSON.stringify(document.querySelector("#artifact").dataset.reviewRevisionReady !== "true")`) as Promise<boolean>,
    "Artifact revision did not begin reloading",
  );
}

export async function waitForRevisionReady(browser: BrowserContext) {
  await waitForCondition(
    () => browser.evaluate(`JSON.stringify(document.querySelector("#artifact").dataset.reviewRevisionReady === "true")`) as Promise<boolean>,
    "Artifact revision did not settle",
  );
}

export async function waitForCondition(check: () => Promise<boolean>, failure: string) {
  const deadline = Date.now() + CONDITION_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await check()) return;
    await Bun.sleep(50);
  }
  throw new Error(failure);
}

async function createSession(server: { baseUrl: string }, artifact: string) {
  return fetch(`${server.baseUrl}/api/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: artifact, purpose: "feedback" }),
  }).then((response) => response.json());
}

function pollForAgentEvent(
  server: { agentToken: string; baseUrl: string },
  key: string,
  signal: AbortSignal,
) {
  return fetch(`${server.baseUrl}/api/sessions/${key}/poll`, {
    headers: { "x-review-artifact-agent-token": server.agentToken },
    signal,
  });
}

async function waitForListening(browser: BrowserContext) {
  await waitForCondition(
    () => browser.evaluate(`JSON.stringify(document.body.dataset.presence === "listening")`) as Promise<boolean>,
    "Review shell did not start listening",
  );
}
