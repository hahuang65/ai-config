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
  browserPoolDirectory = await mkdtemp(path.join(tmpdir(), "review-artifact-failure-pool-"));
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

test("replaces stale overlays with one limited-comparison marker", async () => {
  const review = await startChangeReviewFromHtml(browserPool, simpleArtifact("Draft"));
  try {
    await writeFile(review.artifact, simpleArtifact("Revised"));
    await waitForOneRegion(review);
    await writeFile(review.artifact, oversizedArtifact());
    await waitForStatus(review, "Detailed highlights are limited");
    const interactionWorked = await review.browser.evaluateChild(`JSON.stringify((() => {
      document.querySelector("button").click();
      return document.body.dataset.interacted;
    })())`);

    expect({ interactionWorked, surface: await readChangeSurface(review.browser) }).toEqual({
      interactionWorked: "yes",
      surface: {
        changeBarVisible: true,
        count: "Detailed highlights are limited",
        regions: [],
      },
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("recovers from unavailable settlement through a new silent baseline", async () => {
  const review = await startChangeReviewFromHtml(browserPool, simpleArtifact("Draft"));
  try {
    await writeFile(review.artifact, unstableArtifact());
    await waitForStatus(review, "Change comparison unavailable");
    await writeFile(review.artifact, simpleArtifact("Recovered"));
    await waitForRevisionReload(review.browser);
    const recovered = await readChangeSurface(review.browser);

    await writeFile(review.artifact, simpleArtifact("Final"));
    await waitForOneRegion(review);

    expect({ recovered, final: await readChangeSurface(review.browser) }).toEqual({
      recovered: { changeBarVisible: false, count: "", regions: [] },
      final: {
        changeBarVisible: true,
        count: "1 changed region",
        regions: [{ kind: "updated", target: "failure-copy" }],
      },
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

async function waitForOneRegion(review: Awaited<ReturnType<typeof startChangeReviewFromHtml>>) {
  await waitForCondition(
    () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
    "Changed revision did not render one region",
  );
}

async function waitForStatus(
  review: Awaited<ReturnType<typeof startChangeReviewFromHtml>>,
  status: string,
) {
  await waitForCondition(
    () => readChangeSurface(review.browser).then((surface) => surface.count === status),
    `${status} marker did not render`,
  );
}

function simpleArtifact(copy: string) {
  return `<!doctype html><title>Comparison failure - Spec</title><main><p id="failure-copy">${copy}</p></main>`;
}

function oversizedArtifact() {
  const elements = Array.from({ length: 2_501 }, (_, index) => `<span>${index}</span>`).join("");
  return `<!doctype html><title>Comparison failure - Spec</title><main>${elements}
    <button type="button">Interact</button></main><script>
      document.querySelector("button").addEventListener("click",()=>{document.body.dataset.interacted="yes"});
    </script>`;
}

function unstableArtifact() {
  return `<!doctype html><title>Comparison failure - Spec</title><main><p id="failure-copy">Rendering</p></main>
    <script>const output=document.querySelector("#failure-copy");let pass=0;
      setInterval(()=>{pass+=1;output.textContent="Rendering "+pass},50);
    </script>`;
}
