import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  closeChangeReview,
  readChangeSurface,
  startChangeReviewFromHtml,
  waitForCondition,
  waitForRevisionReload,
} from "./change-browser-support";
import { startFirefoxBidiPool } from "./firefox-bidi";

const macFirefox = "/Applications/Firefox.app/Contents/MacOS/firefox";
const firefox = Bun.which("firefox") ?? (existsSync(macFirefox) ? macFirefox : null);
if (!firefox) throw new Error("Firefox is required for review-artifact browser evidence");

const TEST_TIMEOUT_MS = 20_000;
let browserPool: Awaited<ReturnType<typeof startFirefoxBidiPool>>;
let browserPoolDirectory: string;

beforeAll(async () => {
  browserPoolDirectory = await mkdtemp(path.join(tmpdir(), "review-artifact-settling-pool-"));
  browserPool = await startFirefoxBidiPool({
    executable: firefox,
    profile: path.join(browserPoolDirectory, "firefox-profile"),
  });
}, TEST_TIMEOUT_MS);

afterAll(async () => {
  try {
    await browserPool?.close();
  } finally {
    await rm(browserPoolDirectory, { recursive: true, force: true });
  }
}, TEST_TIMEOUT_MS);

test("keeps later artifact interactions outside the frozen baseline", async () => {
  const review = await startChangeReviewFromHtml(browserPool, interactionArtifact("Source draft"));
  try {
    await review.browser.evaluateChild(`JSON.stringify((() => {
      document.querySelector("details").open = true;
      const input = document.querySelector("input");
      input.value = "Keyboard interaction";
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      document.querySelector("button").click();
      return document.querySelector("#source-copy").textContent;
    })())`);

    await writeFile(review.artifact, interactionArtifact("Source draft"));
    await waitForRevisionReload(review.browser);
    const unchanged = await readChangeSurface(review.browser);

    await writeFile(review.artifact, interactionArtifact("Source revised"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
      "Source revision after interaction did not compare with the frozen baseline",
    );

    expect({ unchanged, revised: await readChangeSurface(review.browser) }).toEqual({
      unchanged: { changeBarVisible: false, count: "", regions: [] },
      revised: {
        changeBarVisible: true,
        count: "1 changed region",
        regions: [{ kind: "updated", target: "source-copy" }],
      },
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("compares source-driven DOM output after each load settles", async () => {
  const review = await startChangeReviewFromHtml(browserPool, settlingSourceArtifact("Settled draft"));
  try {
    await waitForSourceOutput(review.browser, "Settled draft");
    await writeFile(review.artifact, settlingSourceArtifact("Settled revision"));
    await waitForRevisionReload(review.browser);
    await waitForSourceOutput(review.browser, "Settled revision");

    expect(await readChangeSurface(review.browser)).toEqual({
      changeBarVisible: true,
      count: "1 changed region",
      regions: [{ kind: "updated", target: "source-output" }],
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

async function waitForSourceOutput(
  browser: { evaluateChild(script: string): Promise<unknown> },
  copy: string,
) {
  await waitForCondition(
    () => browser.evaluateChild(
      `JSON.stringify(document.querySelector("#source-output").textContent === ${JSON.stringify(copy)})`,
    ) as Promise<boolean>,
    `Source output did not settle to ${copy}`,
  );
}

function interactionArtifact(sourceCopy: string) {
  return `<!doctype html><title>Interaction baseline - Spec</title><main>
    <p id="source-copy">${sourceCopy}</p><details><summary>More</summary><p>Details</p></details>
    <input><button type="button">Interact</button></main><script>
      const output = document.querySelector("#source-copy");
      document.querySelector("input").addEventListener("keydown", () => { output.textContent = "Keyboard mutation"; });
      document.querySelector("button").addEventListener("click", () => { output.textContent = "Pointer mutation"; });
    </script>`;
}

function settlingSourceArtifact(settledCopy: string) {
  return `<!doctype html><title>Settled source output - Spec</title>
    <main><p id="source-output">Rendering source output</p></main><script>
      const output = document.querySelector("#source-output");
      let renderPass = 0;
      function renderSourceOutput() {
        output.textContent = "Rendering source output";
        renderPass += 1;
        if (renderPass < 10) { setTimeout(renderSourceOutput, 50); return; }
        output.textContent = ${JSON.stringify(settledCopy)};
      }
      renderSourceOutput();
    </script>`;
}
