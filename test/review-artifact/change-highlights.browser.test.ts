import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  clickChangeControl,
  closeChangeReview,
  readChangeSurface,
  readNavigationSurface,
  startChangeReviewFromHtml,
  waitForActiveTarget,
  waitForCondition,
  waitForRevisionReady,
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
  browserPoolDirectory = await mkdtemp(path.join(tmpdir(), "review-artifact-change-pool-"));
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

test("shows Moved and Updated and moved for stable reordered regions", async () => {
  const review = await startChangeReviewFromHtml(browserPool, reorderArtifact(false));
  try {
    await writeFile(review.artifact, reorderArtifact(true));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 2),
      "Stable reordered regions did not render move markers",
    );

    expect(await readChangeSurface(review.browser)).toMatchObject({
      regions: [
        { kind: "updated-moved", target: "beta" },
        { kind: "moved", target: "alpha" },
      ],
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("ignores metadata, script output pixels, and hidden automation attributes", async () => {
  const review = await startChangeReviewFromHtml(browserPool, ignoredChangeArtifact("draft", "red"));
  try {
    await writeFile(review.artifact, ignoredChangeArtifact("complete", "blue"));
    await waitForRevisionReload(review.browser);

    expect(await readChangeSurface(review.browser)).toEqual({
      changeBarVisible: false,
      count: "",
      regions: [],
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("shows Updated for review status, accessibility, and native control changes", async () => {
  const review = await startChangeReviewFromHtml(browserPool, attributeArtifact("pending", "Start", true));
  try {
    await writeFile(review.artifact, attributeArtifact("complete", "Continue", false));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 2),
      "Review-relevant attribute changes did not render Updated regions",
    );

    expect(await readChangeSurface(review.browser)).toMatchObject({
      regions: [
        { kind: "updated", target: "status-region" },
        { kind: "updated", target: "native-control" },
      ],
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("shows Updated when canonical style rules change visible presentation", async () => {
  const review = await startChangeReviewFromHtml(browserPool, styledArtifact("#365f78", "200px"));
  try {
    await writeFile(review.artifact, styledArtifact("#a94f32", "240px"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
      "Visible inline-style change did not render an Updated region",
    );

    expect(await readChangeSurface(review.browser)).toMatchObject({
      regions: [{ kind: "updated", target: "styled-region" }],
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("uses one page marker when no useful removal container survives", async () => {
  const review = await startChangeReviewFromHtml(
    browserPool,
    '<!doctype html><title>Page removal - Spec</title><main><h1>Delete page</h1><p>Removed copy</p></main>',
  );
  try {
    await writeFile(review.artifact, "<!doctype html><title>Page removal - Spec</title>");
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
      "Page-level removal marker did not render",
    );

    expect(await readChangeSurface(review.browser)).toMatchObject({
      count: "1 changed region",
      regions: [{ kind: "removed", target: "page" }],
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("shows Added content and anchors Removed content without restoring it", async () => {
  const review = await startChangeReviewFromHtml(browserPool, structuralArtifact());
  try {
    await writeFile(review.artifact, structuralArtifact('<p id="new-note">New review note</p>'));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.some((region) => region.kind === "added")),
      "Added content did not receive a changed-region marker",
    );
    const added = await readChangeSurface(review.browser);

    await writeFile(review.artifact, structuralArtifact());
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.some((region) => region.kind === "removed")),
      "Removed content did not receive a surviving-container marker",
    );
    const removed = await readChangeSurface(review.browser);
    const deletedTextPresent = await review.browser.evaluateChild(
      `JSON.stringify(document.body.textContent.includes("New review note"))`,
    );

    expect({ added, removed, deletedTextPresent }).toMatchObject({
      added: { regions: [{ kind: "added", target: "new-note" }] },
      removed: { regions: [{ kind: "removed", target: "change-container" }] },
      deletedTextPresent: false,
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("Dismiss clears presentation until the next artifact revision", async () => {
  const review = await startChangeReview("Draft");
  try {
    await writeFile(review.artifact, latestChangeArtifact("Revised"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
      "Changed revision did not render before dismissal",
    );
    const scrollBefore = await review.browser.evaluateChild(`JSON.stringify(scrollY)`);
    const dismissed = await clickChangeControl(review.browser, "dismiss");
    if (dismissed) {
      await waitForCondition(
        () => readChangeSurface(review.browser).then((surface) => !surface.changeBarVisible && surface.regions.length === 0),
        "Dismiss did not clear change presentation",
      );
    }
    const scrollAfter = await review.browser.evaluateChild(`JSON.stringify(scrollY)`);

    await writeFile(review.artifact, latestChangeArtifact("Final"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
      "A later revision did not appear after dismissal",
    );

    expect({ dismissed, scrollBefore, scrollAfter, surface: await readChangeSurface(review.browser) }).toMatchObject({
      dismissed: true,
      scrollAfter: scrollBefore,
      surface: { changeBarVisible: true, regions: [{ target: "latest-change-copy" }] },
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("Previous initially selects the last region and navigation wraps", async () => {
  const review = await startChangeReviewFromHtml(browserPool, navigationArtifact("First draft", "Last draft"));
  try {
    await writeFile(review.artifact, navigationArtifact("First revised", "Last revised"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 2),
      "Two Updated regions did not render",
    );

    const previousClicked = await clickChangeControl(review.browser, "previous");
    if (previousClicked) {
      await waitForActiveTarget(review.browser, "last-change");
      await clickChangeControl(review.browser, "previous");
      await waitForActiveTarget(review.browser, "first-change");
      await clickChangeControl(review.browser, "next");
      await waitForActiveTarget(review.browser, "last-change");
    }

    expect({ previousClicked, surface: await readNavigationSurface(review.browser) }).toMatchObject({
      previousClicked: true,
      surface: { activeTargets: ["last-change"] },
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("Next initially selects and scrolls to the first changed region", async () => {
  const review = await startChangeReviewFromHtml(browserPool, navigationArtifact("First draft", "Last draft"));
  try {
    await writeFile(review.artifact, navigationArtifact("First revised", "Last revised"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 2),
      "Two Updated regions did not render",
    );
    const before = await readNavigationSurface(review.browser);
    const clicked = await review.browser.evaluate(`JSON.stringify((() => {
      const next = document.querySelector('[data-review-change-action="next"]');
      if (!next) return false;
      next.click();
      return true;
    })())`);
    if (clicked) {
      await waitForCondition(
        () => readNavigationSurface(review.browser).then((surface) =>
          surface.activeTargets.join() === "first-change" && surface.firstVisible
        ),
        "Next did not select and scroll to the first changed region",
      );
    }
    const after = await readNavigationSurface(review.browser);

    expect({ clicked, before, after }).toMatchObject({
      clicked: true,
      before: { activeTargets: [], visibleTargets: ["first-change", "last-change"], firstVisible: false },
      after: { activeTargets: ["first-change"], visibleTargets: ["first-change", "last-change"], firstVisible: true },
    });
    expect(after.scrollY).toBeLessThan(before.scrollY);
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("clears an unchanged revision and uses it as the next baseline", async () => {
  const review = await startChangeReview("Draft");
  try {
    await writeFile(review.artifact, latestChangeArtifact("Revised"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
      "First changed revision did not render",
    );

    await writeFile(review.artifact, latestChangeArtifact("Revised"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => !surface.changeBarVisible),
      "Unchanged revision did not clear the prior highlight",
    );

    await writeFile(review.artifact, latestChangeArtifact("Final"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
      "Revision after the unchanged baseline did not render",
    );

    expect(await readChangeSurface(review.browser)).toEqual({
      changeBarVisible: true,
      count: "1 changed region",
      regions: [{ kind: "updated", target: "latest-change-copy" }],
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("preserves Explore mode while a changed revision reloads", async () => {
  const review = await startChangeReview("Before mode reload");
  try {
    await review.browser.evaluate(`JSON.stringify(document.querySelector("#mode").click() ?? true)`);
    await writeFile(review.artifact, latestChangeArtifact("After mode reload"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
      "Changed revision did not render in Explore mode",
    );

    expect(await review.browser.evaluate(`JSON.stringify({
      label: document.querySelector("#mode").textContent,
      pressed: document.querySelector("#mode").getAttribute("aria-pressed"),
    })`)).toEqual({ label: "Explore", pressed: "false" });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("shows only the smallest Updated region for the first saved text revision", async () => {
  const review = await startChangeReview("Résumé draft 😀");
  try {
    const initial = await readChangeSurface(review.browser);
    await writeFile(review.artifact, latestChangeArtifact("Résumé revised 😀"));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
      "Saved direct-text change did not render one smallest Updated region",
    );
    const revised = await readChangeSurface(review.browser);

    await review.browser.navigate(review.url);
    await waitForRevisionReady(review.browser);
    const reopened = await readChangeSurface(review.browser);

    expect({ initial, revised, reopened }).toEqual({
      initial: { changeBarVisible: false, count: "", regions: [] },
      revised: {
        changeBarVisible: true,
        count: "1 changed region",
        regions: [{ kind: "updated", target: "latest-change-copy" }],
      },
      reopened: { changeBarVisible: false, count: "", regions: [] },
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

function startChangeReview(copy: string) {
  return startChangeReviewFromHtml(browserPool, latestChangeArtifact(copy));
}

function reorderArtifact(revised: boolean) {
  const alpha = '<article id="alpha">Alpha</article>';
  const beta = `<article id="beta" data-slice-id="S05">${revised ? "Beta revised" : "Beta"}</article>`;
  return `<!doctype html><title>Moved changes - Spec</title><main>${revised ? beta + alpha : alpha + beta}</main>`;
}

function ignoredChangeArtifact(automationState: string, pixelColor: string) {
  return `<!doctype html><meta name="revision" content="${automationState}">
    <title>Ignored changes - Spec</title><main><canvas id="pixels" data-automation="${automationState}"></canvas></main>
    <script>const context=document.querySelector("#pixels").getContext("2d");context.fillStyle="${pixelColor}";context.fillRect(0,0,20,20);</script>`;
}

function attributeArtifact(status: string, label: string, disabled: boolean) {
  return `<!doctype html><title>Attribute changes - Spec</title><main>
    <article id="status-region" data-status="${status}">Implementation slice</article>
    <button id="native-control" aria-label="${label}" ${disabled ? "disabled" : ""}>Run</button>
  </main>`;
}

function styledArtifact(color: string, width: string) {
  return `<!doctype html><title>Styled changes - Spec</title>
    <style>#styled-region{color:${color};width:${width}}</style>
    <main><p id="styled-region">Visible style</p></main>`;
}

function structuralArtifact(content = "") {
  return `<!doctype html><title>Structural changes - Spec</title>
    <main id="change-container"><h1>Summary</h1>${content}</main>`;
}

function navigationArtifact(first: string, last: string) {
  return `<!doctype html><title>Changed-region navigation - Spec</title><style>
    body{margin:0}.change-gap{height:1800px}
  </style><main><p id="first-change">${first}</p><div class="change-gap"></div>
    <p id="last-change">${last}</p><div class="change-gap"></div></main><script>
    if (!new URL(location.href).searchParams.has("reload")) scrollTo(0, 900);
  </script>`;
}

function latestChangeArtifact(copy: string) {
  return `<!doctype html><title>Latest changes - Spec</title><main id="latest-change-parent">
    <h1>Summary</h1><p id="latest-change-copy">${copy}</p><p>Unchanged context</p>
  </main>`;
}
