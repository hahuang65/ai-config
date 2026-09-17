import { expect } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  renderConfirmationPage,
  renderErrorPage,
  renderPublicationForm,
  renderPublicationFragment,
  renderSuccessPage,
} from "../../skills/review-change/runtime/review-publication-html.mjs";
import { PUBLICATION_ERROR_OUTCOMES } from "../../skills/review-change/runtime/review-publication-outcomes.mjs";
import { createConfirmationToken, deriveReview } from "../../skills/review-change/runtime/review-publication-protocol.mjs";
import { createReviewPublicationServer } from "../../skills/review-change/runtime/review-publication-server.mjs";
import { signTestPublicationClaims as createPublicationToken } from "./review-publication-fixtures";

export function registerReviewPublicationBrowserCases({ browserTest, browserPool }: any) {
  browserTest("Review publication derives immutable comments from the selected Findings", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-publication-browser-"));
    const reportPath = path.join(directory, "report.html");
    const findings = [
      finding("RC-001", "Prevent duplicate exports", 84),
      finding("RC-002", "Preserve the failure reason", 41),
      finding("RC-003", "Cover a repeated failure", 116),
    ];
    const publicationToken = createPublicationToken(claims(findings), { key: Buffer.alloc(32, 4) });
    await writeFile(reportPath, renderPublicationForm({ publicationToken, findings }));
    const browser = await browserPool().createContext({ width: 360, height: 800 });
    try {
      await browser.navigate(pathToFileURL(reportPath).href);
      const behavior = await browser.evaluate(`JSON.stringify((() => {
        const checkboxes = [...document.querySelectorAll('input[type="checkbox"]')];
        const output = document.querySelector('#publication-general-comment');
        checkboxes.forEach((checkbox) => checkbox.click());
        const zeroComment = output.textContent;
        checkboxes[0].focus();
        checkboxes[0].click();
        const oneComment = output.textContent;
        checkboxes[2].click();
        return {
          accessibleNames: checkboxes.map((input) => input.getAttribute('aria-label')),
          checked: checkboxes.map((input) => input.checked),
          startupResources: performance.getEntriesByType('resource').length,
          zeroComment,
          oneComment,
          manyComment: output.textContent,
          selectedCount: document.querySelector('#publication-selected-count').textContent,
          focusedCheckbox: document.activeElement === checkboxes[0],
          narrowWithoutOverflow: innerWidth === 360 && document.documentElement.scrollWidth <= innerWidth,
          editableComments: document.querySelectorAll('textarea,[contenteditable="true"]').length,
          manualCopyPanels: document.querySelectorAll('[data-review-copy]').length,
        };
      })())`);
      expect(behavior).toEqual({
        accessibleNames: [
          "Prevent duplicate exports, src/export/export-runner.ts:84",
          "Preserve the failure reason, src/export/export-runner.ts:41",
          "Cover a repeated failure, src/export/export-runner.ts:116",
        ],
        checked: [true, false, true],
        startupResources: 0,
        zeroComment: "Review completed. No Findings were selected for publication.",
        oneComment: "Review found 1 issue worth addressing:\n\n- Prevent duplicate exports",
        manyComment: "Review found 2 issues worth addressing:\n\n- Prevent duplicate exports\n- Cover a repeated failure",
        selectedCount: "2",
        focusedCheckbox: true,
        narrowWithoutOverflow: true,
        editableComments: 0,
        manualCopyPanels: 0,
      });
    } finally {
      await browser.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  browserTest("an embedded production publication fragment submits and restores an exact selection", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-publication-report-"));
    const reportPath = path.join(directory, "review-findings.html");
    const selectedInspections: string[][] = [];
    const findings = [
      finding("RC-001", "Prevent duplicate exports", 84),
      finding("RC-002", "Preserve the failure reason", 41),
      finding("RC-003", "Cover a repeated failure", 116),
    ];
    const currentClaims = claims(findings);
    const key = Buffer.alloc(32, 9);
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
      publishReview: async () => { throw new Error("Browser confirmation must not publish to GitHub"); },
    });
    const fragment = renderPublicationFragment({
      publicationToken: createPublicationToken(currentClaims, { key }),
      findings,
      publisherUrl: publisher.url,
    });
    await writeFile(reportPath, representativeReport(fragment));
    const browser = await browserPool().createContext({ width: 360, height: 800 });
    try {
      await browser.navigate(pathToFileURL(reportPath).href);
      const initial = await browser.evaluate(`JSON.stringify({
        title: document.title,
        selectionFocused: document.activeElement === document.querySelector('input[name="selected_finding_id"]'),
        narrowWithoutOverflow: document.documentElement.scrollWidth <= innerWidth,
      })`);
      await browser.evaluate(`JSON.stringify((() => {
        const boxes = [...document.querySelectorAll('input[name="selected_finding_id"]')];
        boxes[1].click();
        document.querySelector('#review-publication-selection').requestSubmit();
        return true;
      })())`);
      await waitForBrowserPage(browser, "confirmation");
      const confirmation = await browser.evaluate(`JSON.stringify({
        headingFocused: document.activeElement === document.querySelector('h1'),
        hasExpectedAccount: document.body.innerText.includes('@reviewer'),
        hasExpectedDestination: document.body.innerText.includes('acme/payments · PR #842'),
        hasSelectedComments: document.body.innerText.includes('Prevent duplicate exports.') && document.body.innerText.includes('Cover a repeated failure.'),
        excludesClearedComment: !document.body.innerText.includes('Preserve the failure reason.'),
        text: document.body.innerText,
        narrowWithoutOverflow: document.documentElement.scrollWidth <= innerWidth,
      })`);
      await browser.evaluate(`JSON.stringify(document.querySelector('#change-selection').click() ?? true)`);
      await waitForBrowserPage(browser, "selection");
      const returned = await browser.evaluate(`JSON.stringify({
        checked: [...document.querySelectorAll('input[name="selected_finding_id"]')].map((box) => box.checked),
        count: document.querySelector('#publication-selected-count').textContent,
        comment: document.querySelector('#publication-general-comment').textContent,
        narrowWithoutOverflow: document.documentElement.scrollWidth <= innerWidth,
      })`);

      expect({ initial, selectedInspections, confirmation, returned }).toEqual({
        initial: {
          title: "Payments retry - Review Findings",
          selectionFocused: true,
          narrowWithoutOverflow: true,
        },
        selectedInspections: [["RC-001", "RC-003"]],
        confirmation: {
          headingFocused: true,
          hasExpectedAccount: true,
          hasExpectedDestination: true,
          hasSelectedComments: true,
          excludesClearedComment: true,
          text: expect.stringContaining("Review found 2 issues worth addressing:\n\n- Prevent duplicate exports\n- Cover a repeated failure"),
          narrowWithoutOverflow: true,
        },
        returned: {
          checked: [true, false, true],
          count: "2",
          comment: "Review found 2 issues worth addressing:\n\n- Prevent duplicate exports\n- Cover a repeated failure",
          narrowWithoutOverflow: true,
        },
      });
    } finally {
      await browser.close();
      await publisher.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  browserTest("production selection and confirmation use two desktop columns and narrow stacking", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-publication-layout-"));
    const findings = [
      finding("RC-001", "Prevent duplicate exports", 84),
      finding("RC-002", "Preserve the failure reason", 41),
    ];
    const currentClaims = claims(findings);
    const key = Buffer.alloc(32, 4);
    const fragment = renderPublicationFragment({
      publicationToken: createPublicationToken(currentClaims, { key }),
      findings,
    });
    const review = deriveReview(currentClaims, findings.map(({ id }) => id));
    const confirmation = renderConfirmationPage(
      currentClaims,
      review,
      createConfirmationToken({ claims: currentClaims, selectedFindingIds: findings.map(({ id }) => id) }, { key }),
    );
    const selectionPath = path.join(directory, "selection.html");
    const confirmationPath = path.join(directory, "confirmation.html");
    await writeFile(selectionPath, representativeReport(fragment));
    await writeFile(confirmationPath, confirmation);
    try {
      const outcomes: Record<string, unknown> = {};
      for (const [name, width] of [["desktop", 1100], ["narrow", 360]] as const) {
        const browser = await browserPool().createContext({ width, height: 900 });
        try {
          await browser.navigate(pathToFileURL(selectionPath).href);
          const selection = await browser.evaluate(layoutEvidence(".publication-findings-panel", ".publication-summary"));
          await browser.navigate(pathToFileURL(confirmationPath).href);
          const confirmationLayout = await browser.evaluate(layoutEvidence(".publication-confirmation-details", ".publication-confirmation-comments"));
          outcomes[name] = { selection, confirmation: confirmationLayout };
        } finally {
          await browser.close();
        }
      }
      expect(outcomes).toEqual({
        desktop: {
          selection: { sideBySide: true, stacked: false, noOverflow: true, productionStyles: true },
          confirmation: { sideBySide: true, stacked: false, noOverflow: true, productionStyles: true },
        },
        narrow: {
          selection: { sideBySide: false, stacked: true, noOverflow: true, productionStyles: true },
          confirmation: { sideBySide: false, stacked: true, noOverflow: true, productionStyles: true },
        },
      });
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  browserTest("every typed publication error has one focused plain-language corrective outcome", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-publication-outcomes-"));
    const browser = await browserPool().createContext({ width: 360, height: 800 });
    try {
      const failures: Array<{ code: string; evidence: unknown }> = [];
      for (const code of PUBLICATION_ERROR_OUTCOMES) {
        const pagePath = path.join(directory, `${code}.html`);
        await writeFile(pagePath, renderErrorPage(code, {
          expectedActor: "reviewer",
          currentActor: "other-reviewer",
          details: { findingId: "RC-027", title: "Keep the retry safe", path: "src/retry.ts", line: 84 },
        }));
        await browser.navigate(pathToFileURL(pagePath).href);
        const evidence = await browser.evaluate(`JSON.stringify((() => {
          const heading = document.querySelector('h1');
          const paragraphs = [...document.querySelectorAll('.publication-terminal > p')];
          return {
            errorCode: document.querySelector('main')?.dataset.publicationError,
            headingCount: document.querySelectorAll('h1').length,
            headingFocused: document.activeElement === heading,
            concreteHeading: (heading?.textContent?.trim().length ?? 0) > 8,
            hasExplanation: (paragraphs[0]?.textContent?.trim().length ?? 0) > 20,
            hasCorrectiveAction: (document.querySelector('.publication-terminal p strong')?.textContent?.trim().length ?? 0) > 10,
            successState: document.querySelector('main')?.dataset.reviewPublicationState === 'posted',
            successHeading: heading?.textContent?.trim() === 'Review posted.',
          };
        })())`);
        if (JSON.stringify(evidence) !== JSON.stringify({
          errorCode: code,
          headingCount: 1,
          headingFocused: true,
          concreteHeading: true,
          hasExplanation: true,
          hasCorrectiveAction: true,
          successState: false,
          successHeading: false,
        })) failures.push({ code, evidence });
      }
      expect(failures).toEqual([]);
    } finally {
      await browser.close();
      await rm(directory, { force: true, recursive: true });
    }
  });

  browserTest("Review publication states keep clear focus and narrow layouts", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-publication-states-"));
    const currentClaims = claims([finding("RC-001", "Prevent duplicate exports", 84)]);
    const review = deriveReview(currentClaims, ["RC-001"]);
    const pages = {
      confirmation: renderConfirmationPage(
        currentClaims,
        review,
        createConfirmationToken({ claims: currentClaims, selectedFindingIds: ["RC-001"] }, { key: Buffer.alloc(32, 4) }),
      ),
      posted: renderSuccessPage(currentClaims, {
        reviewId: 194205,
        url: "https://github.com/acme/payments/pull/842#pullrequestreview-194205",
      }),
      stale: renderErrorPage("pull_request_scope_changed"),
      invalidLocation: renderErrorPage("invalid_inline_location", {
        details: {
          findingId: "RC-027",
          title: "Keep the export retry safe",
          path: "src/export/export-runner.ts",
          line: 84,
          side: "RIGHT",
        },
      }),
      error: renderErrorPage("provider_authentication_failed"),
      confirmationDenied: renderErrorPage("os_confirmation_denied"),
      confirmationDismissed: renderErrorPage("os_confirmation_dismissed"),
      confirmationTimeout: renderErrorPage("os_confirmation_timeout"),
      confirmationUnavailable: renderErrorPage("os_confirmation_unavailable"),
      confirmationMalformed: renderErrorPage("os_confirmation_invalid_response"),
      confirmationFailed: renderErrorPage("os_confirmation_failed"),
    };
    const browser = await browserPool().createContext({ width: 360, height: 800 });
    try {
      const outcomes: Record<string, unknown> = {};
      for (const [name, html] of Object.entries(pages)) {
        const pagePath = path.join(directory, `${name}.html`);
        await writeFile(pagePath, html);
        await browser.navigate(pathToFileURL(pagePath).href);
        outcomes[name] = await browser.evaluate(`JSON.stringify({
          state: document.querySelector('main').dataset.reviewPublicationState,
          headingCount: document.querySelectorAll('h1').length,
          headingFocused: document.activeElement === document.querySelector('h1'),
          narrowWithoutOverflow: document.documentElement.scrollWidth <= innerWidth,
          primaryActionVisible: !!document.querySelector('.publication-button.primary'),
          visibleText: document.body.innerText,
          machineErrorVisible: document.body.innerText.includes('invalid_inline_location'),
        })`);
      }
      expect(outcomes).toMatchObject({
        confirmation: { state: "confirmation", headingCount: 1, headingFocused: true, narrowWithoutOverflow: true, primaryActionVisible: true },
        posted: { state: "posted", headingCount: 1, headingFocused: true, narrowWithoutOverflow: true, primaryActionVisible: true },
        stale: { state: "stale", headingCount: 1, headingFocused: true, narrowWithoutOverflow: true, primaryActionVisible: false },
        invalidLocation: {
          state: "stale",
          headingCount: 1,
          headingFocused: true,
          narrowWithoutOverflow: true,
          primaryActionVisible: false,
          visibleText: expect.stringContaining("Keep the export retry safe (RC-027) at src/export/export-runner.ts:84"),
          machineErrorVisible: false,
        },
        error: { state: "error", headingCount: 1, headingFocused: true, narrowWithoutOverflow: true, primaryActionVisible: false },
        confirmationDenied: { state: "error", visibleText: expect.stringContaining("Publication was not approved") },
        confirmationDismissed: { state: "error", visibleText: expect.stringContaining("Confirmation was dismissed") },
        confirmationTimeout: { state: "error", visibleText: expect.stringContaining("Confirmation timed out") },
        confirmationUnavailable: { state: "error", visibleText: expect.stringContaining("Operating-system confirmation is unavailable") },
        confirmationMalformed: { state: "error", visibleText: expect.stringContaining("The confirmation response was invalid") },
        confirmationFailed: { state: "error", visibleText: expect.stringContaining("Operating-system confirmation failed") },
      });
    } finally {
      await browser.close();
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Payments retry - Review Findings</title><style>*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui;overflow-wrap:anywhere}main{width:min(100% - 20px,980px);margin:auto}</style></head><body><main><header><p>Review change report</p><h1>Payments retry findings</h1></header><section aria-labelledby="current-findings"><h2 id="current-findings">Current Findings</h2><p>Three Findings need a decision.</p></section>${fragment}</main></body></html>`;
}

function layoutEvidence(primarySelector: string, secondarySelector: string) {
  return `JSON.stringify((() => {
    const primary = document.querySelector(${JSON.stringify(primarySelector)});
    const secondary = document.querySelector(${JSON.stringify(secondarySelector)});
    const primaryRect = primary.getBoundingClientRect();
    const secondaryRect = secondary.getBoundingClientRect();
    return {
      sideBySide: secondaryRect.left >= primaryRect.right - 1 && Math.abs(secondaryRect.top - primaryRect.top) < 2,
      stacked: secondaryRect.top >= primaryRect.bottom - 1,
      noOverflow: document.documentElement.scrollWidth <= innerWidth,
      productionStyles: !!document.querySelector('style[data-review-publication-styles]'),
    };
  })())`;
}

function finding(id: string, title: string, line: number) {
  return {
    id,
    title,
    body: `${title}.`,
    path: "src/export/export-runner.ts",
    line,
    side: "RIGHT",
  };
}

function claims(findings: ReturnType<typeof finding>[]) {
  return {
    reportId: "0b".repeat(16),
    host: "github.com",
    signingKeyId: "review-publication-v1",
    commentTemplateVersion: 1,
    actor: { id: "U_123", login: "reviewer" },
    repository: { id: "R_456", nameWithOwner: "acme/payments" },
    pullRequest: { id: "PR_789", number: 842, url: "https://github.com/acme/payments/pull/842" },
    scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
    findings,
  };
}
