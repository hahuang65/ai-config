import { stripVTControlCharacters } from "node:util";

const DEFAULT_PREVIEW_LENGTH = 120;
const NON_LAYOUT_CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
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
const CREDENTIAL_LAYOUT = String.raw`[\t\r\n]*`;
const CREDENTIAL_NAME = String.raw`[a-z](?:[a-z\d_-]|[\t\r\n]+(?=[a-z\d_-]))*`;
const HORIZONTAL_LAYOUT = String.raw`[ \t]*`;
const CREDENTIAL_VALUE_LAYOUT = String.raw`(?:[ \t]*(?:\r\n|\r|\n)[ \t]+|[ \t]*)`;
const CREDENTIAL_FLAG_MARKER = /(?<![a-z\d_-])-{1,2}/gi;
const CREDENTIAL_ASSIGNMENT_PREFIX = new RegExp(
  String.raw`(?=(?<![a-z\d_-])(${CREDENTIAL_NAME})(${HORIZONTAL_LAYOUT}[=:]${CREDENTIAL_VALUE_LAYOUT}))`,
  "gi",
);
const CREDENTIAL_OBJECT_PREFIX = new RegExp(
  String.raw`(["'])(${CREDENTIAL_LAYOUT}${CREDENTIAL_NAME}${CREDENTIAL_LAYOUT})\1(${HORIZONTAL_LAYOUT}:${CREDENTIAL_VALUE_LAYOUT})`,
  "gi",
);
const AUTHORIZATION_NAME = new RegExp(
  String.raw`(?<![a-z\d_-])${layoutFlexibleLiteral("authorization")}(?![a-z\d_-])`, "gi",
);
const BEARER_VALUE = new RegExp(
  String.raw`((?<![a-z\d_-])${layoutFlexibleLiteral("bearer")}(?![a-z\d_-])\s+)${CREDENTIAL_VALUE}`,
  "gi",
);
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
  const normalized = normalizeTerminalControls(value);
  const knownFormsRedacted = redactAuthorizationValues(normalized
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
  const valueStart = credentialValueStart(value, colon + 1);
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
    if (character === "\r" || character === "\n") {
      const continuation = indentedContinuationStart(value, index);
      if (continuation === null) return index;
      index = continuation - 1;
      continue;
    }
    if (character === ";") return index;
    if (objectKey && (character === "," || character === "}")) return index;
    if (value.startsWith("&&", index) || value.startsWith("||", index)) return index;
    if (character === "|" && /\s/.test(value[index - 1] ?? "")) return index;
    if (!/\s/.test(character)) continue;
    const remainder = value.slice(index).trimStart();
    if (/^(?:[a-z][a-z\d+.-]*:\/\/|--?[a-z\d])/i.test(remainder)) return index;
  }
  return value.length;
}

function indentedContinuationStart(value, newline) {
  if (value[newline] !== "\r" && value[newline] !== "\n") return null;
  let start = newline + 1;
  if (value[newline] === "\r" && value[start] === "\n") start += 1;
  if (value[start] !== " " && value[start] !== "\t") return null;
  while (value[start] === " " || value[start] === "\t") start += 1;
  return start;
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
  let match = CREDENTIAL_FLAG_MARKER.exec(value);
  while (match) {
    const credential = findFlagCredential(value, match.index + match[0].length);
    if (credential) {
      redacted += value.slice(copiedThrough, credential.valueStart);
      redacted += "[REDACTED]";
      copiedThrough = credential.valueEnd;
      CREDENTIAL_FLAG_MARKER.lastIndex = credential.valueEnd;
    }
    match = CREDENTIAL_FLAG_MARKER.exec(value);
  }
  return `${redacted}${value.slice(copiedThrough)}`;
}

function findFlagCredential(value, markerEnd) {
  let nameStart = markerEnd;
  while (/[\t\r\n]/.test(value[nameStart] ?? "")) nameStart += 1;
  let nameEnd = nameStart;
  while (nameEnd < value.length) {
    const delimiter = readFlagDelimiter(value, nameEnd);
    if (delimiter && isCredentialName(value.slice(nameStart, nameEnd))) {
      const credentialValue = readCredentialValue(value, delimiter.end);
      if (credentialValue && (!delimiter.whitespaceSeparated || !credentialValue.optionLike)) {
        return { valueStart: delimiter.end, valueEnd: credentialValue.end };
      }
    }
    const nextNameEnd = advanceFlagName(value, nameEnd);
    if (nextNameEnd === nameEnd) return null;
    nameEnd = nextNameEnd;
  }
  return null;
}

function readFlagDelimiter(value, start) {
  const horizontalEnd = skipHorizontalLayout(value, start);
  if (value[horizontalEnd] === "=" || value[horizontalEnd] === ":") {
    const end = credentialValueStart(value, horizontalEnd + 1);
    return { end, whitespaceSeparated: false };
  }
  const continuation = indentedContinuationStart(value, horizontalEnd);
  if (continuation !== null) return { end: continuation, whitespaceSeparated: true };
  return horizontalEnd > start ? { end: horizontalEnd, whitespaceSeparated: true } : null;
}

function credentialValueStart(value, start) {
  const horizontalEnd = skipHorizontalLayout(value, start);
  return indentedContinuationStart(value, horizontalEnd) ?? horizontalEnd;
}

function skipHorizontalLayout(value, start) {
  let end = start;
  while (value[end] === " " || value[end] === "\t") end += 1;
  return end;
}

function advanceFlagName(value, start) {
  if (/[a-z\d_-]/i.test(value[start] ?? "")) return start + 1;
  if (!/[\t\r\n]/.test(value[start] ?? "")) return start;
  let end = start;
  while (/[\t\r\n]/.test(value[end] ?? "")) end += 1;
  return /[a-z\d_-]/i.test(value[end] ?? "") ? end : start;
}

function redactCredentialAssignments(value) {
  let redacted = "";
  let copiedThrough = 0;
  let match = CREDENTIAL_ASSIGNMENT_PREFIX.exec(value);
  while (match) {
    const prefix = `${match[1]}${match[2]}`;
    const credentialValue = isCredentialName(match[1])
      ? readCredentialValue(value, match.index + prefix.length)
      : null;
    if (credentialValue) {
      redacted += `${value.slice(copiedThrough, match.index)}${prefix}[REDACTED]`;
      copiedThrough = credentialValue.end;
      CREDENTIAL_ASSIGNMENT_PREFIX.lastIndex = credentialValue.end;
    } else {
      CREDENTIAL_ASSIGNMENT_PREFIX.lastIndex = match.index + 1;
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

function layoutFlexibleLiteral(value) {
  return Array.from(value).join(CREDENTIAL_LAYOUT);
}

function isCredentialName(name) {
  const normalizedName = name
    .replace(/[\t\r\n]+/g, "")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/([a-z\d])([A-Z])/g, "$1_$2");
  const segments = normalizedName.toLowerCase().split(/[-_]+/);
  return CREDENTIAL_CORES.some((core) => {
    if (segments.length < core.length) return false;
    const coreStart = segments.length - core.length;
    return core.every((segment, index) => segments[coreStart + index] === segment);
  });
}

function normalizeTerminalControls(value) {
  return stripVTControlCharacters(String(value)).replace(NON_LAYOUT_CONTROL, "");
}

function singleLine(value) {
  return normalizeTerminalControls(value)
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
