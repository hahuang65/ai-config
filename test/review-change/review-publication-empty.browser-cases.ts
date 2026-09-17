import { expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { renderPublicationFragment } from "../../skills/review-change/runtime/review-publication-html.mjs";
import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { signTestPublicationClaims as createPublicationToken } from "./review-publication-fixtures";

export function registerEmptyReviewPublicationBrowserCase({ browserTest, browserPool }: any) {
  browserTest("an initially empty production report focuses Continue and reaches zero-comment confirmation", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-publication-empty-browser-"));
    const reportPath = path.join(directory, "review-findings.html");
    const currentClaims = emptyClaims();
    const selectedInspections: string[][] = [];
    const key = Buffer.alloc(32, 8);
    const publisher = await createReviewPublicationServer({
      key,
      inspectPullRequest: async (_claims: any, selectedFindings: any[]) => {
        selectedInspections.push(selectedFindings.map((finding) => finding.id));
        return {
          actor: currentClaims.actor,
          repository: currentClaims.repository,
          pullRequest: { ...currentClaims.pullRequest, state: "OPEN" },
          scope: currentClaims.scope,
        };
      },
      publishReview: async () => { throw new Error("Empty browser confirmation must not publish to GitHub"); },
    });
    const fragment = renderPublicationFragment({
      publicationToken: createPublicationToken(currentClaims, { key }),
      findings: [],
      publisherUrl: publisher.url,
    });
    await writeFile(reportPath, representativeReport(fragment));
    const browser = await browserPool().createContext({ width: 360, height: 800 });
    try {
      await browser.navigate(pathToFileURL(reportPath).href);
      const initial = await browser.evaluate(`JSON.stringify({
        continueFocused: document.activeElement === document.querySelector('#review-publication-selection button[type="submit"]'),
        checkboxCount: document.querySelectorAll('input[name="selected_finding_id"]').length,
        count: document.querySelector('#publication-selected-count').textContent,
        comment: document.querySelector('#publication-general-comment').textContent,
      })`);
      await browser.evaluate(`JSON.stringify(document.querySelector('#review-publication-selection').requestSubmit() ?? true)`);
      await waitForBrowserPage(browser, "confirmation");
      const confirmation = await browser.evaluate(`JSON.stringify({
        headingFocused: document.activeElement === document.querySelector('h1'),
        generalComment: document.querySelector('.publication-preview p').textContent,
        inlineCommentCount: document.querySelectorAll('.publication-confirmation-comments .publication-preview').length - 1,
      })`);

      expect({ initial, selectedInspections, confirmation }).toEqual({
        initial: {
          continueFocused: true,
          checkboxCount: 0,
          count: "0",
          comment: "Review completed. No Findings were selected for publication.",
        },
        selectedInspections: [[]],
        confirmation: {
          headingFocused: true,
          generalComment: "Review completed. No Findings were selected for publication.",
          inlineCommentCount: 0,
        },
      });
    } finally {
      await browser.close();
      await publisher.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
}

async function waitForBrowserPage(browser: any, state: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const current = await browser.evaluate(`JSON.stringify(document.querySelector('[data-review-publication-state]')?.dataset.reviewPublicationState)`);
      if (current === state) return;
    } catch {}
    await Bun.sleep(25);
  }
  throw new Error(`Review publication did not reach the ${state} page`);
}

function representativeReport(fragment: string) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payments retry - Review Findings</title></head><body><main><h1>Payments retry findings</h1>${fragment}</main></body></html>`;
}

function emptyClaims() {
  return {
    reportId: "0b".repeat(16),
    host: "github.com",
    signingKeyId: "review-publication-v1",
    commentTemplateVersion: 1,
    actor: { id: "U_123", login: "reviewer" },
    repository: { id: "R_456", nameWithOwner: "acme/payments" },
    pullRequest: { id: "PR_789", number: 842, url: "https://github.com/acme/payments/pull/842" },
    scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
    findings: [],
  };
}
