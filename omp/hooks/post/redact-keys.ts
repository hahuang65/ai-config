// redact-keys.ts
//
// Post-hook: redacts secret-shaped strings in tool output before the model
// sees them. Net-new capability — TTSR fundamentally cannot mutate tool
// output. See docs/adr/0006 for why this lives only as a hook.
//
// Filters tool_result events to text-emitting tools (`read`, `bash`),
// skips error results (don't trip over the leakage on the error path),
// iterates content blocks, and applies a multi-pattern redaction with a
// placeholder allowlist so docs/fixture values pass through unmolested.

import type { HookAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";

const REDACT_TOOLS = new Set(["read", "edit", "bash"]);

// Values that look like placeholders should NOT be redacted — they're
// documentation noise, not real secrets. Redacting them makes diffs
// unreadable and convinces the model the user has 50 different API keys.
function isPlaceholder(value: string): boolean {
  if (value.length < 8) return true;
  const lower = value.toLowerCase();
  if (lower.includes("xxx")) return true;
  if (lower.includes("your-")) return true;
  if (lower.includes("your_")) return true;
  if (lower.includes("placeholder")) return true;
  if (lower.includes("example")) return true;
  if (lower.includes("redacted")) return true; // already redacted
  if (/^<[^>]*>$/.test(value)) return true; // <placeholder>, <key>, etc.
  if (/^\.{3,}$/.test(value)) return true; // ... or ....
  if (/^(.)\1{7,}$/.test(value)) return true; // all same char (≥ 8 long)
  return false;
}

type SecretPattern = {
  name: string;
  regex: RegExp;
  replace: (match: string, ...groups: string[]) => string;
};

const SECRET_PATTERNS: SecretPattern[] = [
  // KEY=value shapes — preserve key name, separator, and quotes around redaction.
  {
    name: "key=value",
    regex:
      /\b(API[_-]?KEY|SECRET|TOKEN|PASSWORD|BEARER|AUTH(?:_TOKEN)?|ACCESS[_-]?KEY|PRIVATE[_-]?KEY)(\s*[:=]\s*)(["']?)([^"'\s;,}<>&|`$()\n]{8,})\3/gi,
    replace: (m, key, sep, quote, value) => {
      if (isPlaceholder(value)) return m;
      return `${key}${sep}${quote}[REDACTED]${quote}`;
    },
  },
  // HTTP Authorization header: `Bearer <token>`
  {
    name: "http-bearer",
    regex: /(Bearer\s+)([A-Za-z0-9._-]{16,})/g,
    replace: (m, prefix, value) => {
      if (isPlaceholder(value)) return m;
      return `${prefix}[REDACTED]`;
    },
  },
  // AWS access key IDs: AKIA + 16 uppercase alphanumeric chars
  {
    name: "aws-key-id",
    regex: /\b(AKIA[A-Z0-9]{16})\b/g,
    replace: (m, value) => (isPlaceholder(value) ? m : "[REDACTED-AWS-KEY-ID]"),
  },
  // GitHub tokens: ghp_/gho_/ghu_/ghs_/ghr_ + 36+ chars (classic format)
  // plus github_pat_ + 82+ chars (fine-grained PATs, introduced 2022).
  {
    name: "github-token",
    regex: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{82,})\b/g,
    replace: (m, value) => (isPlaceholder(value) ? m : "[REDACTED-GITHUB-TOKEN]"),
  },
  // JWT: eyJ-prefixed three-segment base64 chain
  {
    name: "jwt",
    regex: /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
    replace: (m, value) => (isPlaceholder(value) ? m : "[REDACTED-JWT]"),
  },
];

function redactText(text: string): string {
  let result = text;
  for (const { regex, replace } of SECRET_PATTERNS) {
    // Reset regex state — important because regexes carry lastIndex with /g
    regex.lastIndex = 0;
    result = result.replace(regex, replace);
  }
  return result;
}

export default function (pi: HookAPI): void {
  pi.on("tool_result", (event) => {
    if (!REDACT_TOOLS.has(event.toolName)) return;
    if (event.isError) return;
    const content = event.content.map((block) => {
      if (block.type !== "text" || typeof block.text !== "string") return block;
      return { ...block, text: redactText(block.text) };
    });
    return { content };
  });
}
