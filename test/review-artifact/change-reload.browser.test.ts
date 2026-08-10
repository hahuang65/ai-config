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
  waitForRevisionReady,
  waitForRevisionReload,
  waitForRevisionReloadStart,
} from "./change-browser-support";
import { startFirefoxBidiPool } from "./firefox-bidi";

const macFirefox = "/Applications/Firefox.app/Contents/MacOS/firefox";
const firefox = Bun.which("firefox") ?? (existsSync(macFirefox) ? macFirefox : null);
if (!firefox) throw new Error("Firefox is required for review-artifact browser evidence");

const TEST_TIMEOUT_MS = 20_000;
let browserPool: Awaited<ReturnType<typeof startFirefoxBidiPool>>;
let browserPoolDirectory: string;

beforeAll(async () => {
  browserPoolDirectory = await mkdtemp(path.join(tmpdir(), "review-artifact-reload-pool-"));
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

test("coalesces a slow intermediate save into the newest settled revision", async () => {
  const review = await startChangeReviewFromHtml(browserPool, revisionArtifact("Draft"));
  try {
    await writeFile(review.artifact, slowRevisionArtifact("Intermediate"));
    await waitForRevisionReloadStart(review.browser);
    await writeFile(review.artifact, revisionArtifact("Newest"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) =>
        surface.regions.length === 1 && surface.regions[0].target === "revision-copy"
      ),
      "Newest settled revision did not replace the intermediate save",
    );

    expect({
      copy: await review.browser.evaluateChild(`JSON.stringify(document.querySelector("#revision-copy").textContent)`),
      surface: await readChangeSurface(review.browser),
    }).toEqual({
      copy: "Newest",
      surface: {
        changeBarVisible: true,
        count: "1 changed region",
        regions: [{ kind: "updated", target: "revision-copy" }],
      },
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("keeps revision baselines independent between tabs", async () => {
  const review = await startChangeReviewFromHtml(browserPool, revisionArtifact("Draft"));
  let secondTab: Awaited<ReturnType<typeof browserPool.createContext>> | undefined;
  try {
    await writeFile(review.artifact, revisionArtifact("First"));
    await waitForOneRegion(review.browser);

    secondTab = await browserPool.createContext({ width: 960, height: 900 });
    await secondTab.navigate(review.url);
    await waitForRevisionReady(secondTab);
    const secondInitial = await readChangeSurface(secondTab);

    await writeFile(review.artifact, revisionArtifact("Second"));
    await Promise.all([waitForRevisionReload(review.browser), waitForRevisionReload(secondTab)]);
    await Promise.all([waitForOneRegion(review.browser), waitForOneRegion(secondTab)]);

    expect({
      first: await readChangeSurface(review.browser),
      second: await readChangeSurface(secondTab),
      secondInitial,
    }).toMatchObject({
      first: { regions: [{ kind: "updated", target: "revision-copy" }] },
      second: { regions: [{ kind: "updated", target: "revision-copy" }] },
      secondInitial: { changeBarVisible: false, regions: [] },
    });
  } finally {
    await secondTab?.close();
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

async function waitForOneRegion(browser: Parameters<typeof readChangeSurface>[0]) {
  await waitForCondition(
    () => readChangeSurface(browser).then((surface) => surface.regions.length === 1),
    "Changed revision did not render one region",
  );
}

function revisionArtifact(copy: string) {
  return `<!doctype html><title>Reload lifecycle - Spec</title><main><p id="revision-copy">${copy}</p></main>`;
}

function slowRevisionArtifact(copy: string) {
  return `<!doctype html><title>Reload lifecycle - Spec</title><main><p id="revision-copy">Rendering</p></main>
    <script>const output=document.querySelector("#revision-copy");let pass=0;
      function render(){pass+=1;output.textContent="Rendering "+pass;if(pass<12){setTimeout(render,50);return;}output.textContent=${JSON.stringify(copy)};}render();
    </script>`;
}
