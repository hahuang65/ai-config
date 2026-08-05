const DEFAULT_PREVIEW_LENGTH = 120;
const CREDENTIAL_CORES = [
  ["api", "key"],
  ["private", "key"],
  ["secret", "key"],
  ["secret", "access", "key"],
  ["access", "token"],
  ["auth", "token"],
  ["client", "secret"],
  ["token"],
  ["password"],
  ["passwd"],
  ["secret"],
];
const CREDENTIAL_VALUE = String.raw`(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\S+)`;
const CREDENTIAL_FLAG_PREFIX = /(?<![a-z\d_-])(-{1,2})([a-z][a-z\d_-]*)(\s*[=:]\s*|\s+)/gi;
const CREDENTIAL_ASSIGNMENT_PREFIX = /(?<![a-z\d_-])([a-z][a-z\d_-]*)(\s*[=:]\s*)/gi;
const CREDENTIAL_OBJECT_PREFIX = /(["'])([a-z][a-z\d_-]*)\1(\s*:\s*)/gi;
const AUTHORIZATION_NAME = /\bauthorization\b/gi;
const BEARER_VALUE = new RegExp(`(\\bbearer\\s+)${CREDENTIAL_VALUE}`, "gi");
const URI_USERINFO = /\b([a-z][a-z\d+.-]*:\/\/)[^/\s@]+@/gi;

export function credentialRedactedPreview(value, maximumLength = DEFAULT_PREVIEW_LENGTH) {
  const redacted = singleLine(redactCredentials(value));
  return boundedPreview(redacted, maximumLength);
}

export function boundedPreview(value, maximumLength) {
  const characters = Array.from(String(value));
  if (characters.length <= maximumLength) {
    return { text: characters.join(""), omittedCharacters: 0 };
  }

  let visibleCharacters = maximumLength;
  while (true) {
    const omittedCharacters = characters.length - visibleCharacters;
    const suffix = `… [${omittedCharacters} characters omitted]`;
    const nextVisibleCharacters = Math.max(0, maximumLength - Array.from(suffix).length);
    if (nextVisibleCharacters === visibleCharacters) {
      return {
        text: `${characters.slice(0, visibleCharacters).join("")}${suffix}`,
        omittedCharacters,
      };
    }
    visibleCharacters = nextVisibleCharacters;
  }
}

export function truncateText(value, maximumLength) {
  const characters = Array.from(String(value));
  const omittedCharacters = Math.max(0, characters.length - maximumLength);
  return {
    text: characters.slice(0, maximumLength).join(""),
    omittedCharacters,
  };
}

export function redactCredentials(value) {
  const knownFormsRedacted = redactAuthorizationValues(String(value)
    .replace(URI_USERINFO, "$1[REDACTED]@"))
    .replace(BEARER_VALUE, "$1[REDACTED]");
  const objectFormsRedacted = redactCredentialObjectProperties(knownFormsRedacted);
  return redactCredentialAssignments(redactCredentialFlags(objectFormsRedacted))
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[REDACTED]")
    .replace(/\b(?:github_pat_[A-Za-z0-9_]+|gh[pousr]_[A-Za-z0-9_]+|npm_[A-Za-z0-9]+|sk-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/g, "[REDACTED]");
}

function redactAuthorizationValues(value) {
  let redacted = "";
  let copiedThrough = 0;
  let match = AUTHORIZATION_NAME.exec(value);
  while (match) {
    const range = authorizationValueRange(value, match.index, AUTHORIZATION_NAME.lastIndex);
    if (range) {
      redacted += `${value.slice(copiedThrough, range.start)}[REDACTED]`;
      copiedThrough = range.end;
      AUTHORIZATION_NAME.lastIndex = range.end;
    }
    match = AUTHORIZATION_NAME.exec(value);
  }
  return `${redacted}${value.slice(copiedThrough)}`;
}

function authorizationValueRange(value, nameStart, nameEnd) {
  const quotedKey = quotedAuthorizationKey(value, nameStart, nameEnd);
  const colon = quotedKey?.colon ?? nextNonWhitespace(value, nameEnd);
  if (value[colon] !== ":") return null;
  const valueStart = nextNonWhitespace(value, colon + 1);
  if (valueStart >= value.length) return null;
  if (quotedKey) return objectValueRange(value, valueStart);
  const enclosingQuote = activeQuoteOnLine(value, nameStart);
  if (enclosingQuote) {
    return boundedRange(value, valueStart, findClosingQuote(value, valueStart, enclosingQuote));
  }
  if (value[valueStart] === "\"" || value[valueStart] === "'") {
    const quote = value[valueStart];
    return boundedRange(value, valueStart + 1, findClosingQuote(value, valueStart + 1, quote));
  }
  const objectKey = new Set(["{", ","]).has(previousNonWhitespace(value, nameStart));
  return boundedRange(value, valueStart, findUnquotedAuthorizationEnd(value, valueStart, objectKey));
}

function quotedAuthorizationKey(value, nameStart, nameEnd) {
  const quote = value[nameStart - 1];
  if (quote !== "\"" && quote !== "'") return null;
  const closingQuote = nextNonWhitespace(value, nameEnd);
  if (value[closingQuote] !== quote) return null;
  const colon = nextNonWhitespace(value, closingQuote + 1);
  return value[colon] === ":" ? { colon } : null;
}

function objectValueRange(value, valueStart) {
  const quote = value[valueStart];
  if (quote === "\"" || quote === "'") {
    return boundedRange(value, valueStart + 1, findClosingQuote(value, valueStart + 1, quote));
  }
  return boundedRange(value, valueStart, findUnquotedAuthorizationEnd(value, valueStart, true));
}

function findUnquotedAuthorizationEnd(value, start, objectKey) {
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\r" || character === "\n" || character === ";") return index;
    if (objectKey && (character === "," || character === "}")) return index;
    if (value.startsWith("&&", index) || value.startsWith("||", index)) return index;
    if (character === "|" && /\s/.test(value[index - 1] ?? "")) return index;
    if (!/\s/.test(character)) continue;
    const remainder = value.slice(index).trimStart();
    if (/^(?:[a-z][a-z\d+.-]*:\/\/|--?[a-z\d])/i.test(remainder)) return index;
  }
  return value.length;
}

function activeQuoteOnLine(value, end) {
  let active = null;
  let escaped = false;
  const lineStart = Math.max(value.lastIndexOf("\n", end - 1), value.lastIndexOf("\r", end - 1)) + 1;
  for (let index = lineStart; index < end; index += 1) {
    const character = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character !== "\"" && character !== "'") continue;
    if (active === character) active = null;
    else if (active === null) active = character;
  }
  return active;
}

function findClosingQuote(value, start, quote) {
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    if (!escaped && value[index] === quote) return index;
    escaped = !escaped && value[index] === "\\";
  }
  return value.length;
}

function boundedRange(value, start, candidateEnd) {
  let end = candidateEnd;
  while (end > start && /\s/.test(value[end - 1])) end -= 1;
  return end > start ? { start, end } : null;
}

function nextNonWhitespace(value, start) {
  let index = start;
  while (index < value.length && /\s/.test(value[index])) index += 1;
  return index;
}

function previousNonWhitespace(value, start) {
  let index = start - 1;
  while (index >= 0 && /\s/.test(value[index])) index -= 1;
  return value[index];
}

function redactCredentialObjectProperties(value) {
  let redacted = "";
  let copiedThrough = 0;
  let match = CREDENTIAL_OBJECT_PREFIX.exec(value);
  while (match) {
    if (isCredentialName(match[2])) {
      const credentialRange = readObjectCredentialRange(value, match.index + match[0].length);
      if (credentialRange) {
        redacted += `${value.slice(copiedThrough, match.index)}${match[0]}`;
        redacted += `${value.slice(match.index + match[0].length, credentialRange.start)}[REDACTED]`;
        copiedThrough = credentialRange.end;
        CREDENTIAL_OBJECT_PREFIX.lastIndex = credentialRange.end;
      }
    }
    match = CREDENTIAL_OBJECT_PREFIX.exec(value);
  }
  return `${redacted}${value.slice(copiedThrough)}`;
}

function readObjectCredentialRange(value, start) {
  if (start >= value.length) return null;
  const quote = value[start] === "\"" || value[start] === "'" ? value[start] : null;
  if (quote) return boundedRange(value, start + 1, findClosingQuote(value, start + 1, quote));
  let end = start;
  while (end < value.length && !/[\s,}]/.test(value[end])) end += 1;
  return boundedRange(value, start, end);
}

function redactCredentialFlags(value) {
  let redacted = "";
  let copiedThrough = 0;
  let match = CREDENTIAL_FLAG_PREFIX.exec(value);
  while (match) {
    if (isCredentialName(match[2])) {
      const credentialValue = readCredentialValue(value, match.index + match[0].length);
      const whitespaceSeparated = match[3].trim() === "";
      if (credentialValue && (!whitespaceSeparated || !credentialValue.optionLike)) {
        redacted += `${value.slice(copiedThrough, match.index)}${match[0]}[REDACTED]`;
        copiedThrough = credentialValue.end;
        CREDENTIAL_FLAG_PREFIX.lastIndex = credentialValue.end;
      }
    }
    match = CREDENTIAL_FLAG_PREFIX.exec(value);
  }
  return `${redacted}${value.slice(copiedThrough)}`;
}

function redactCredentialAssignments(value) {
  let redacted = "";
  let copiedThrough = 0;
  let match = CREDENTIAL_ASSIGNMENT_PREFIX.exec(value);
  while (match) {
    if (isCredentialName(match[1])) {
      const credentialValue = readCredentialValue(value, match.index + match[0].length);
      if (credentialValue) {
        redacted += `${value.slice(copiedThrough, match.index)}${match[0]}[REDACTED]`;
        copiedThrough = credentialValue.end;
        CREDENTIAL_ASSIGNMENT_PREFIX.lastIndex = credentialValue.end;
      }
    }
    match = CREDENTIAL_ASSIGNMENT_PREFIX.exec(value);
  }
  return `${redacted}${value.slice(copiedThrough)}`;
}

function readCredentialValue(value, start) {
  if (start >= value.length || /\s/.test(value[start])) return null;
  const quote = value[start] === "\"" || value[start] === "'" ? value[start] : null;
  if (!quote) {
    let end = start;
    while (end < value.length && !/\s/.test(value[end])) end += 1;
    return { end, optionLike: value[start] === "-" };
  }
  const closingQuote = findClosingQuote(value, start + 1, quote);
  return { end: Math.min(value.length, closingQuote + 1), optionLike: false };
}

function isCredentialName(name) {
  const segments = name.toLowerCase().split(/[-_]+/);
  return CREDENTIAL_CORES.some((core) => {
    if (segments.length < core.length) return false;
    const coreStart = segments.length - core.length;
    return core.every((segment, index) => segments[coreStart + index] === segment);
  });
}

function singleLine(value) {
  return String(value)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
