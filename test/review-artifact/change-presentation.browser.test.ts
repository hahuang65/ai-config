import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  clickChangeControl,
  closeChangeReview,
  readChangeSurface,
  startChangeReviewFromHtml,
  waitForCondition,
} from "./change-browser-support";
import { startFirefoxBidiPool } from "./firefox-bidi";

const macFirefox = "/Applications/Firefox.app/Contents/MacOS/firefox";
const firefox = Bun.which("firefox") ?? (existsSync(macFirefox) ? macFirefox : null);
if (!firefox) throw new Error("Firefox is required for review-artifact browser evidence");

const TEST_TIMEOUT_MS = 20_000;
let browserPool: Awaited<ReturnType<typeof startFirefoxBidiPool>>;
let browserPoolDirectory: string;

beforeAll(async () => {
  browserPoolDirectory = await mkdtemp(path.join(tmpdir(), "review-artifact-presentation-pool-"));
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

test("keeps runtime highlights out of the canonical artifact source", async () => {
  const review = await startChangeReviewFromHtml(browserPool, presentationArtifact("Draft copy"));
  try {
    const revisedSource = presentationArtifact("Fresh copy");
    await writeFile(review.artifact, revisedSource);
    await waitForOneRegion(review);
    await clickChangeControl(review.browser, "next");
    await review.browser.evaluateChild(`JSON.stringify((() => {
      const target = document.querySelector("#presentation-change");
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return true;
    })())`);
    await clickChangeControl(review.browser, "dismiss");

    expect(await readFile(review.artifact, "utf8")).toBe(revisedSource);
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("keeps change controls and keyboard mode usable at the narrow shell width", async () => {
  const review = await startChangeReviewFromHtml(browserPool, presentationArtifact("Draft copy"), 480);
  try {
    await writeFile(review.artifact, presentationArtifact("Fresh copy"));
    await waitForOneRegion(review);
    const shell = await review.browser.evaluate(`JSON.stringify((() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "i", ctrlKey: true, bubbles: true }));
      const bar = document.querySelector("[data-review-change-bar]").getBoundingClientRect();
      const controlsVisible = [...document.querySelectorAll("[data-review-change-action]")]
        .every((control) => control.getBoundingClientRect().width > 0);
      return {
        controlsVisible,
        mode: document.querySelector("#mode").textContent,
        noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth,
        barWithinViewport: bar.left >= 0 && bar.right <= innerWidth + 1,
      };
    })())`);
    const artifactFits = await review.browser.evaluateChild(
      `JSON.stringify(document.documentElement.scrollWidth <= innerWidth)`,
    );

    expect({ artifactFits, shell }).toEqual({
      artifactFits: true,
      shell: {
        controlsVisible: true,
        mode: "Explore",
        noHorizontalOverflow: true,
        barWithinViewport: true,
      },
    });
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("keeps annotation hover and locate outlines above the change cue", async () => {
  const review = await startChangeReviewFromHtml(browserPool, presentationArtifact("Draft copy"));
  try {
    await writeFile(review.artifact, presentationArtifact("Fresh copy"));
    await waitForOneRegion(review);
    await review.browser.evaluateChild(`JSON.stringify((() => {
      const target = document.querySelector("#presentation-change");
      target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      return true;
    })())`);
    await review.browser.evaluate(`JSON.stringify((() => {
      document.querySelector("#artifact").contentWindow.postMessage({
        type: "review:locate", selector: "#presentation-change", scroll: false
      }, "*");
      return true;
    })())`);

    const composition = await review.browser.evaluateChild(`JSON.stringify((() => {
      const target = document.querySelector("#presentation-change");
      const overlay = document.querySelector("[data-review-artifact-change]");
      const badge = overlay.querySelector('[data-review-artifact-ui="change-badge"]');
      return {
        annotation: { color: target.style.outline, offset: target.style.outlineOffset },
        badge: badge.textContent.trim(),
        pattern: getComputedStyle(overlay).borderImageSource,
      };
    })())`);

    expect(composition).toMatchObject({
      annotation: { color: "rgb(182, 92, 56) solid 2px", offset: "2px" },
      badge: "Updated",
    });
    expect(composition.pattern).toMatch(/gradient\(/i);
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("shows plain-language badges for every change type", async () => {
  const review = await startChangeReviewFromHtml(browserPool, changeTypeArtifact(false));
  try {
    await writeFile(review.artifact, changeTypeArtifact(true));
    await waitForCondition(
      () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 4),
      "All change-type presentations did not render",
    );

    expect(await review.browser.evaluateChild(`JSON.stringify(
      [...document.querySelectorAll('[data-review-artifact-ui="change-badge"]')]
        .map((badge) => badge.textContent.trim())
    )`)).toEqual(["Updated and moved", "Moved", "Added", "Removed"]);
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

test("shows a patterned rail and plain-language badge without changing artifact layout", async () => {
  const review = await startChangeReviewFromHtml(browserPool, presentationArtifact("Draft copy"));
  try {
    const before = await targetRect(review.browser);
    await writeFile(review.artifact, presentationArtifact("Fresh copy"));
    await waitForOneRegion(review);

    const presentation = await review.browser.evaluateChild(`JSON.stringify((() => {
      const overlay = document.querySelector('[data-review-artifact-change="updated"]');
      const badge = overlay.querySelector('[data-review-artifact-ui="change-badge"]');
      const style = getComputedStyle(overlay);
      const badgeRect = badge.getBoundingClientRect();
      return {
        badge: { label: badge.textContent.trim(), visible: badgeRect.width > 0 && badgeRect.height > 0 },
        pattern: [style.backgroundImage, style.borderImageSource].join(" "),
        pointerFree: style.pointerEvents === "none",
        target: (() => { const rect = document.querySelector("#presentation-change").getBoundingClientRect();
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; })(),
      };
    })())`);

    expect({ before, presentation }).toMatchObject({
      before: presentation.target,
      presentation: {
        badge: { label: "Updated", visible: true },
        pointerFree: true,
      },
    });
    expect(presentation.pattern).toMatch(/gradient\(/i);
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

async function waitForOneRegion(review: Awaited<ReturnType<typeof startChangeReviewFromHtml>>) {
  await waitForCondition(
    () => readChangeSurface(review.browser).then((surface) => surface.regions.length === 1),
    "Updated presentation did not render",
  );
}

function targetRect(browser: Awaited<ReturnType<typeof startChangeReviewFromHtml>>["browser"]) {
  return browser.evaluateChild(`JSON.stringify((() => {
    const rect = document.querySelector("#presentation-change").getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  })())`);
}

function changeTypeArtifact(revised: boolean) {
  const alpha = '<article id="alpha">Alpha</article>';
  const beta = `<article id="beta">${revised ? "Beta revised" : "Beta"}</article>`;
  const third = revised ? '<article id="gamma">Gamma</article>' : '<article id="delta">Delta</article>';
  return `<!doctype html><title>Change types - Spec</title><main>${revised ? beta + alpha + third : alpha + beta + third}</main>`;
}

function presentationArtifact(copy: string) {
  return `<!doctype html><title>Change presentation - Spec</title><style>
    body{margin:0;padding:48px}#presentation-change{width:240px;min-height:72px;margin:0;font:16px/24px sans-serif}
  </style><main><p id="presentation-change">${copy}</p></main>`;
}
