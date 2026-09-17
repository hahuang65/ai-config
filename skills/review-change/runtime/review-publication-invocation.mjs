import { parseArguments } from "./arguments.mjs";
import { parseGitHubTarget } from "./github-target.mjs";

const REVIEW_CHANGE_INVOCATION = /^\s*(?:\/(?:skill:)?review-change|review\s+change)(?=\s|$)/i;

export function isReviewChangeInvocation(text) {
  return REVIEW_CHANGE_INVOCATION.test(text);
}

export function requestedPullRequestTarget(text) {
  const invocation = REVIEW_CHANGE_INVOCATION.exec(text);
  if (!invocation) return null;
  try {
    const { target } = parseArguments(tokenizeArguments(text.slice(invocation[0].length)));
    return target === null ? null : canonicalPullRequestTarget(target);
  } catch {
    return null;
  }
}

function tokenizeArguments(source) {
  const arguments_ = [];
  let token = "";
  let quote = "";
  let escaped = false;
  let started = false;
  for (const character of source) {
    if (escaped) {
      token += character;
      escaped = false;
      started = true;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
      started = true;
    } else if (quote) {
      if (character === quote) quote = "";
      else token += character;
    } else if (character === "\"" || character === "'") {
      quote = character;
      started = true;
    } else if (/\s/u.test(character)) {
      if (started) arguments_.push(token);
      token = "";
      started = false;
    } else {
      token += character;
      started = true;
    }
  }
  if (escaped || quote) throw new Error("Review change arguments are incomplete");
  if (started) arguments_.push(token);
  return arguments_;
}

function canonicalPullRequestTarget(candidate) {
  try {
    const parsed = parseGitHubTarget(candidate);
    if (parsed.kind !== "pull-request") return null;
    return `https://github.com/${parsed.owner}/${parsed.repository}/pull/${parsed.number}`;
  } catch {
    return null;
  }
}
