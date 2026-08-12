const MAX_TARGET_LENGTH = 2_048;
const MAX_PULL_REQUEST_NUMBER_TEXT = "2147483647";
const GITHUB_OWNER_PATTERN = /^(?=.{1,39}$)[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*$/;
const GITHUB_REPOSITORY_PATTERN = /^(?=.{1,100}$)(?!\.{1,2}$)[a-zA-Z0-9._-]+$/;

export function isGitHubTargetInput(target) {
  return Boolean(target && (/^https?:\/\//i.test(target) || target.startsWith("gh:")));
}

export function parseGitHubTarget(target) {
  if (!target || /\p{Cc}/u.test(target)) throw new Error("The GitHub target must be one non-empty line");
  if (target.length > MAX_TARGET_LENGTH) throw new Error("The GitHub target is too long");
  if (target.startsWith("gh:")) return parseConciseGitHubTarget(target);
  const parsedUrl = parseGitHubUrl(target);
  const [owner, repository, changeKind, targetValue, ...branchSegments] = parsedUrl.pathname.split("/").filter(Boolean);
  if (!isValidGitHubRepositoryIdentity(owner, repository)) throw new Error("The GitHub target is malformed");
  if (changeKind === "pull" && isCanonicalPullRequestNumber(targetValue)) {
    return { kind: "pull-request", owner, repository, number: Number(targetValue) };
  }
  if (changeKind === "tree" && targetValue) {
    return { kind: "branch", owner, repository, branch: [targetValue, ...branchSegments].join("/") };
  }
  throw new Error("The GitHub target is malformed");
}

export function canonicalGitHubSshUrl({ owner, repository }) {
  return `git@github.com:${owner}/${repository}.git`;
}

export function parseGitHubRepositoryUrl(remoteUrl) {
  if (/\p{Cc}/u.test(remoteUrl)) return null;
  const scpMatch = /^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/.exec(remoteUrl);
  if (scpMatch) {
    if (hasNormalizationSensitiveSegments(`${scpMatch[1]}/${scpMatch[2]}`)) return null;
    return isValidGitHubRepositoryIdentity(scpMatch[1], scpMatch[2])
      ? { owner: scpMatch[1], repository: scpMatch[2] }
      : null;
  }
  if (!hasCanonicalRawUrlPath(remoteUrl)) return null;
  try {
    const parsedUrl = new URL(remoteUrl);
    const [, owner, rawRepository, ...extra] = parsedUrl.pathname.split("/");
    const repository = rawRepository?.replace(/\.git$/, "");
    if (!isDocumentedGitHubTransport(parsedUrl) || !owner || !rawRepository || extra.length > 0) return null;
    return isValidGitHubRepositoryIdentity(owner, repository) ? { owner, repository } : null;
  } catch {
    return null;
  }
}

function hasCanonicalRawUrlPath(remoteUrl) {
  if (remoteUrl.includes("\\")) return false;
  const match = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*(\/[^?#]*)/i.exec(remoteUrl);
  return Boolean(match && !hasNormalizationSensitiveSegments(match[1].slice(1)));
}

function hasNormalizationSensitiveSegments(rawPath) {
  return rawPath.split("/").some(isNormalizationSensitiveSegment);
}

function isValidGitHubRepositoryIdentity(owner, repository) {
  return GITHUB_OWNER_PATTERN.test(owner ?? "") && GITHUB_REPOSITORY_PATTERN.test(repository ?? "");
}

function isDocumentedGitHubTransport(url) {
  if (url.hostname !== "github.com" || url.password || url.search || url.hash) return false;
  if (url.protocol === "https:") return !url.username && !url.port;
  return url.protocol === "ssh:" && url.username === "git" && new Set(["", "22"]).has(url.port);
}

export function isCanonicalPullRequestNumber(value) {
  if (!/^[1-9]\d*$/.test(value)) return false;
  if (value.length !== MAX_PULL_REQUEST_NUMBER_TEXT.length) {
    return value.length < MAX_PULL_REQUEST_NUMBER_TEXT.length;
  }
  return value <= MAX_PULL_REQUEST_NUMBER_TEXT;
}

function parseConciseGitHubTarget(target) {
  if (/[?#\\]/.test(target) || target.endsWith("/")) throw new Error("The GitHub target is malformed");
  const segments = target.slice(3).split("/");
  if (segments.some(isNormalizationSensitiveSegment)) throw new Error("The GitHub target is malformed");
  const [owner, repository, changeKind, targetValue, ...branchSegments] = segments;
  if (!isValidGitHubRepositoryIdentity(owner, repository)) throw new Error("The GitHub target is malformed");
  if (changeKind === "pull" && branchSegments.length === 0 && isCanonicalPullRequestNumber(targetValue)) {
    return { kind: "pull-request", owner, repository, number: Number(targetValue) };
  }
  if (changeKind === "tree" && targetValue) {
    return { kind: "branch", owner, repository, branch: [targetValue, ...branchSegments].join("/") };
  }
  throw new Error("The GitHub target is malformed");
}

function isNormalizationSensitiveSegment(segment) {
  if (!segment) return true;
  try {
    const decoded = decodeURIComponent(segment);
    return new Set([".", ".."]).has(decoded) || /[\\/]/.test(decoded);
  } catch {
    return false;
  }
}

function validateCanonicalBrowserEndpoint(target) {
  const pathMatch = /^https:\/\/github\.com(?::443)?(\/[^?#]*)?(?:[?#]|$)/.exec(target);
  if (!pathMatch) throw new Error("The GitHub target is malformed");
  const segments = (pathMatch[1] ?? "").split("/").slice(1);
  if (segments.some(isNormalizationSensitiveSegment)) {
    throw new Error("The GitHub target is malformed");
  }
}

function parseGitHubUrl(target) {
  let url;
  try {
    url = new URL(target);
  } catch {
    throw new Error("The GitHub target is malformed");
  }
  if (url.origin !== "https://github.com") {
    throw new Error("The GitHub target is malformed");
  }
  if (url.username || url.password) throw new Error("The GitHub target must not include credentials");
  validateCanonicalBrowserEndpoint(target);
  return url;
}
