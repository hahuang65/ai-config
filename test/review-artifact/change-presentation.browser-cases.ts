import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";

import { changeBrowserPool as browserPool } from "./change-browser-pool";
import {
  clickChangeControl,
  closeChangeReview,
  readChangeSurface,
  startChangeReviewFromHtml,
  waitForCondition,
} from "./change-browser-support";

const TEST_TIMEOUT_MS = 20_000;
const LAYOUT_TEST_TIMEOUT_MS = 30_000;
const LAYOUT_TOLERANCE_PX = 1;
const LAYOUT_VIEWPORTS = [
  { height: 900, name: "wide", narrow: false, width: 1280 },
  { height: 900, name: "narrow", narrow: true, width: 480 },
  { height: 2063, name: "tall", narrow: false, width: 1646 },
] as const;

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

test("fills the artifact panel content row across viewport shapes and revision states", async () => {
  const violations: string[] = [];
  for (const viewport of LAYOUT_VIEWPORTS) {
    const review = await startChangeReviewFromHtml(
      browserPool,
      presentationArtifact("Draft copy"),
      viewport.width,
      viewport.height,
    );
    try {
      violations.push(...await readLayoutViolations(review.browser, viewport, false));
      await writeFile(review.artifact, presentationArtifact("Fresh copy"));
      await waitForOneRegion(review);
      violations.push(...await readLayoutViolations(review.browser, viewport, true));
    } finally {
      await closeChangeReview(review);
    }
  }

  expect(violations).toEqual([]);
}, LAYOUT_TEST_TIMEOUT_MS);

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
        tint: getComputedStyle(overlay).backgroundColor,
      };
    })())`);

    expect(composition).toMatchObject({
      annotation: { color: "rgb(182, 92, 56) solid 2px", offset: "2px" },
      badge: "Updated",
    });
    expect(composition.tint).toBe("rgba(196, 49, 132, 0.08)");
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

test("shows a contrasting subtle tint and plain-language badge without changing artifact layout", async () => {
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
        tint: style.backgroundColor,
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
    expect(presentation.tint).toBe("rgba(196, 49, 132, 0.08)");
  } finally {
    await closeChangeReview(review);
  }
}, TEST_TIMEOUT_MS);

async function readLayoutViolations(
  browser: Awaited<ReturnType<typeof startChangeReviewFromHtml>>["browser"],
  viewport: typeof LAYOUT_VIEWPORTS[number],
  expectedBarVisible: boolean,
) {
  const geometry = await measureShellGeometry(browser);
  const state = expectedBarVisible ? "visible" : "hidden";
  const prefix = `${viewport.name}/${state}`;
  const violations: string[] = [];
  recordEdgeViolation(violations, prefix, "left", geometry.iframe.left, geometry.content.left);
  recordEdgeViolation(violations, prefix, "right", geometry.iframe.right, geometry.content.right);
  recordEdgeViolation(
    violations,
    prefix,
    "top",
    geometry.iframe.top,
    expectedBarVisible ? geometry.barBottom : geometry.content.top,
  );
  recordEdgeViolation(violations, prefix, "bottom", geometry.iframe.bottom, geometry.content.bottom);
  if (geometry.barVisible !== expectedBarVisible) violations.push(`${prefix}: unexpected change-bar visibility`);
  if (viewport.narrow && geometry.panelBottom > geometry.conversationTop + LAYOUT_TOLERANCE_PX) {
    violations.push(`${prefix}: artifact panel does not precede conversation`);
  }
  if (viewport.narrow && geometry.scrollWidth > geometry.viewportWidth + LAYOUT_TOLERANCE_PX) {
    violations.push(`${prefix}: shell overflows horizontally`);
  }
  return violations;
}

function measureShellGeometry(browser: Awaited<ReturnType<typeof startChangeReviewFromHtml>>["browser"]) {
  return browser.evaluate(`JSON.stringify((() => {
    const panel = document.querySelector(".artifact-panel");
    const iframe = document.querySelector("#artifact");
    const bar = document.querySelector("[data-review-change-bar]");
    const conversation = document.querySelector(".conversation");
    const panelRect = panel.getBoundingClientRect();
    const iframeRect = iframe.getBoundingClientRect();
    const barRect = bar.getBoundingClientRect();
    const panelStyle = getComputedStyle(panel);
    const edge = (value) => Number.parseFloat(value) || 0;
    return {
      barBottom: barRect.bottom,
      barVisible: !bar.hidden,
      content: {
        bottom: panelRect.bottom - edge(panelStyle.borderBottomWidth) - edge(panelStyle.paddingBottom),
        left: panelRect.left + edge(panelStyle.borderLeftWidth) + edge(panelStyle.paddingLeft),
        right: panelRect.right - edge(panelStyle.borderRightWidth) - edge(panelStyle.paddingRight),
        top: panelRect.top + edge(panelStyle.borderTopWidth) + edge(panelStyle.paddingTop),
      },
      conversationTop: conversation.getBoundingClientRect().top,
      iframe: { bottom: iframeRect.bottom, left: iframeRect.left, right: iframeRect.right, top: iframeRect.top },
      panelBottom: panelRect.bottom,
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth: innerWidth,
    };
  })())`) as Promise<ShellGeometry>;
}

function recordEdgeViolation(
  violations: string[],
  prefix: string,
  edge: string,
  actual: number,
  expected: number,
) {
  const delta = actual - expected;
  if (Math.abs(delta) > LAYOUT_TOLERANCE_PX) violations.push(`${prefix}: ${edge} delta ${delta}px`);
}

interface ShellGeometry {
  barBottom: number;
  barVisible: boolean;
  content: { bottom: number; left: number; right: number; top: number };
  conversationTop: number;
  iframe: { bottom: number; left: number; right: number; top: number };
  panelBottom: number;
  scrollWidth: number;
  viewportWidth: number;
}

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
