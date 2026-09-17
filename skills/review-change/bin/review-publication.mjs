#!/usr/bin/env node

import { lstat, open, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";

import { renderPublicationClaims } from "../runtime/review-publication-boundary.mjs";
import { validateGitHubCliPath } from "../runtime/review-publication-executable.mjs";
import { renderPublicationFragment } from "../runtime/review-publication-html.mjs";
import { validateInheritedPublicationSocket } from "../runtime/review-publication-socket.mjs";
import { runReviewPublicationRequest } from "../runtime/review-publication-worker.mjs";

const MAX_CLAIMS_BYTES = 1024 * 1024;
const FRAGMENT_SUFFIX = ".review-fragment";
const arguments_ = process.argv.slice(2);

if (arguments_[0] === "--inetd" && arguments_.length === 1) {
  await runProductionRequest().catch((error) => {
    process.stderr.write(`${error?.message ?? "Review publication worker failed."}\n`);
    process.exitCode = 1;
  });
} else if (arguments_[0] === "--sign" && arguments_.length === 3) await signAndRender(arguments_[1], arguments_[2]);
else if (arguments_[0] === "--validate-github-executable" && arguments_.length === 2) {
  process.stdout.write(`${validateGitHubCliPath(arguments_[1])}\n`);
} else {
  process.stderr.write("Usage: review-publication --inetd | --sign <claims-file> <form.review-fragment>\n");
  process.exitCode = 2;
}

async function signAndRender(claimsFile, fragmentFile) {
  const root = await realpath(process.env.REVIEW_CHANGE_REPORT_ROOT ?? process.env.TMPDIR ?? "/tmp");
  const resolvedClaims = await validateInputFile(claimsFile, root);
  const resolvedFragment = await validateOutputPath(fragmentFile, root, FRAGMENT_SUFFIX, "Publication form");
  let source;
  try {
    source = await readFile(resolvedClaims, "utf8");
  } finally {
    await rm(claimsFile, { force: true });
  }
  const submitted = JSON.parse(source);
  const { frozenScope, ...claims } = submitted;
  const rendered = await renderPublicationClaims(claims, { frozenScope });
  const fragment = renderPublicationFragment({
    publicationToken: rendered.publicationToken,
    findings: claims.findings,
    review: rendered.review,
  });
  const handle = await open(resolvedFragment, "wx", 0o600);
  try {
    await handle.writeFile(fragment, "utf8");
  } finally {
    await handle.close();
  }
  process.stdout.write(`${fragmentFile}\n`);
}

async function validateInputFile(candidate, root) {
  const resolved = await realpath(candidate);
  if (path.dirname(resolved) !== root) throw new Error("Publication claims must be in the report root");
  const state = await lstat(candidate);
  if (!state.isFile() || state.isSymbolicLink()) throw new Error("Publication claims must be a regular file");
  if (state.size > MAX_CLAIMS_BYTES) throw new Error("Publication claims exceed the size limit");
  return resolved;
}

async function validateOutputPath(candidate, root, suffix, label) {
  const parent = await realpath(path.dirname(path.resolve(candidate)));
  if (parent !== root) throw new Error(`${label} must be in the report root`);
  if (!path.basename(candidate).endsWith(suffix)) throw new Error(`${label} must use the ${suffix} suffix`);
  return path.join(root, path.basename(candidate));
}

async function runProductionRequest() {
  validateInheritedPublicationSocket();
  await runReviewPublicationRequest();
}
