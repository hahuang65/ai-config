import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { buildReviewChangePrompt } from "../skills/review-change/runtime/prompt.mjs";

test("standalone reports offer Review publication only for exact GitHub pull requests", async () => {
  const [reportContract, skillContract, findingContract, reviewerContract] = await Promise.all([
    readFile(path.resolve(import.meta.dir, "../skills/review-change/references/report.md"), "utf8"),
    readFile(path.resolve(import.meta.dir, "../skills/review-change/SKILL.md"), "utf8"),
    readFile(path.resolve(import.meta.dir, "../skills/review-change/references/findings.md"), "utf8"),
    readFile(path.resolve(import.meta.dir, "../agents/change-reviewer.md"), "utf8"),
  ]);
  const publicationMetadata = {
    host: "github.com",
    signingKeyId: "review-publication-v1",
    commentTemplateVersion: 1,
    frozenScope: "parent-signed-scope",
    signerPath: "/Users/reviewer/.local/bin/review-publication",
    repository: { id: "R_456", nameWithOwner: "acme/payments" },
    pullRequest: { id: "PR_789", number: 842, url: "https://github.com/acme/payments/pull/842" },
    scope: { baseOid: "a".repeat(40), headOid: "b".repeat(40) },
  };
  const promptFor = (scopeKind: string, metadata?: typeof publicationMetadata) => buildReviewChangePrompt({
    target: scopeKind === "pull-request"
      ? publicationMetadata.pullRequest.url
      : `${"a".repeat(40)}...${"b".repeat(40)}`,
    intent: null,
    scopeKind,
    sourceRoot: "/reviews/payments",
    reviewRoot: "/reviews/payments-head",
    immutableRange: `${"a".repeat(40)}...${"b".repeat(40)}`,
    selectedHeadOid: "b".repeat(40),
    sourceScopeResolved: true,
    skillDirectory: "/skills/review-change",
    publicationMetadata: metadata,
  });
  const pullRequestPrompt = promptFor("pull-request", publicationMetadata);
  const localRangePrompt = promptFor("local-range");
  const invocation = JSON.parse(/^Invocation data: (.+)$/m.exec(pullRequestPrompt)?.[1] ?? "{}");

  expect({
    cliPublicationMetadata: invocation.publicationMetadata,
    skillRequiresPublicationMetadata:
      reportContract.includes("validated provider identity")
      && reportContract.includes("exact base and head")
      && reportContract.includes("path, line, and side"),
    pullRequestUsesPublicationForm:
      reportContract.includes("deterministic shared form")
      && pullRequestPrompt.includes("trusted renderer")
      && pullRequestPrompt.includes("Embed that rendered fragment unchanged"),
    ordinarySkillPreparesTrustedScope:
      skillContract.includes("review_change_publication")
      && skillContract.includes("Claude Code prompt hook")
      && reportContract.includes("both supported harnesses")
      && reportContract.includes("before model work")
      && reportContract.includes("only the Finding ID")
      && reportContract.includes("UserPromptSubmit")
      && reportContract.includes(".review-fragment"),
    parentFrozenScope:
      reportContract.includes("parent freezes")
      && reportContract.includes("trusted boundary generates the random report identity")
      && pullRequestPrompt.includes("Do not add an actor or report identity"),
    formPostsOnlyCapabilityAndSelection:
      reportContract.includes("http://127.0.0.1:4392/api/v1/review-publication-confirmations")
      && reportContract.includes("publication_token")
      && reportContract.includes("selected_finding_id"),
    operatingSystemConfirmationRequired:
      reportContract.includes("operating-system confirmation outside model-visible channels")
      && reportContract.includes("Only explicit operating-system approval")
      && reportContract.includes("HTTP request, signed report, environment, or helper arguments"),
    explicitDiffSide:
      reviewerContract.includes("`side`")
      && reviewerContract.includes("`LEFT`")
      && reviewerContract.includes("old or deleted")
      && reviewerContract.includes("`RIGHT`")
      && reviewerContract.includes("new, added, or current")
      && findingContract.includes("Never guess, default, or remap")
      && pullRequestPrompt.includes("Never guess, default, or remap a Finding side"),
    manualCopyPanelsRetired:
      !reportContract.includes("copyable provider-review text")
      && !reportContract.includes("pull-request copy section")
      && !pullRequestPrompt.includes("copyable general-review Markdown")
      && !pullRequestPrompt.includes("copyable Markdown block per Finding"),
    localRangeIsPresentationOnly:
      localRangePrompt.includes("presentation-only")
      && localRangePrompt.includes("no Review publication")
      && !localRangePrompt.includes('"publicationMetadata"'),
  }).toEqual({
    cliPublicationMetadata: publicationMetadata,
    skillRequiresPublicationMetadata: true,
    pullRequestUsesPublicationForm: true,
    ordinarySkillPreparesTrustedScope: true,
    parentFrozenScope: true,
    formPostsOnlyCapabilityAndSelection: true,
    operatingSystemConfirmationRequired: true,
    explicitDiffSide: true,
    manualCopyPanelsRetired: true,
    localRangeIsPresentationOnly: true,
  });
});
