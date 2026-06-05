// guard-core.ts
//
// The shared guard core (ADR-0011): detection logic for every guardrail
// policy, written ONCE and imported unchanged by every harness whose hook API
// can run it. Harnesses route a normalized tool call through `evaluate`; the
// core returns a block verdict or null (allow).
//
// Command detectors are predicates over `anyPipeline` (see bash-command.ts) —
// the statement/pipe/substitution traversal lives there, not here.

import { POLICIES } from "./policy-registry";
import { anyPipeline, tokenize, leadingWord } from "./bash-command";

/** Harness-neutral shape every adapter normalizes its tool call into. */
export interface ToolCall {
  /** Canonical tool name, e.g. "read", "edit", "write", "bash". */
  tool: string;
  /** The command string, for command-running tools. */
  command?: string;
  /** The target path, for file tools. */
  path?: string;
  /** The payload being written, for write/edit tools. */
  content?: string;
}

/** A refusal: which policy fired and why. */
export interface Verdict {
  policy: string;
  reason: string;
}

/** Returns a refusal reason for the given call, or null to allow. */
type Detector = (call: ToolCall) => string | null;

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// ── no-shell-write ───────────────────────────────────────────────────────

// Output redirected (>, >>) or tee'd into a REAL file — bypassing the per-file
// approval the write/edit tools provide. Device targets (/dev/null, stderr,
// stdout, fd) and FD merges (2>&1, >&N) are excluded.
const SHELL_WRITE_PATTERNS: RegExp[] = [
  /\b(?:echo|printf|cat)\b[^;&|<>\n]*>>?\s*(?!\/dev\/(?:null|stderr|stdout|fd)\b|&\d)[^\s|&>]/,
  /\btee\s+(?:-\S+\s+)*(?!\/dev\/(?:null|stderr|stdout|fd)\b)[^\s|&>-]/,
];

function detectShellWrite(call: ToolCall): string | null {
  if (call.command && SHELL_WRITE_PATTERNS.some((p) => p.test(call.command!))) {
    return "Refused — writing a file via shell redirection bypasses per-file approval. Use the write/edit tool instead.";
  }
  return null;
}

// ── no-hardcoded-secret ──────────────────────────────────────────────────

// Known credential FORMATS only — high-confidence, low false-positive. A short
// placeholder (`sk-xxx`) or prose mentioning a key does not match; the fuzzier
// "looks like a secret assignment" heuristics stay advisory in rules/security.md.
const SECRET_LITERAL_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{20,}/,                  // OpenAI / Anthropic-style provider keys
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,            // AWS access key id
  /\bgh[pousra]_[A-Za-z0-9]{30,}/,            // GitHub tokens (ghp_, gho_, …, gha_)
  /\bgithub_pat_[A-Za-z0-9_]{20,}/,           // GitHub fine-grained PAT
  /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/, // PEM private-key block
];

function detectHardcodedSecret(call: ToolCall): string | null {
  if (call.content && SECRET_LITERAL_PATTERNS.some((p) => p.test(call.content!))) {
    return "Refused — hardcoded secret literal in written content. Use an environment variable or a secrets manager; never commit a key. If one was staged, rotate it.";
  }
  return null;
}

// ── no-secret-access ─────────────────────────────────────────────────────

const CREDENTIAL_PATTERNS: RegExp[] = [
  /\.aws\/credentials/,
  /\.kube\/config/,
  /\.ssh\/id_[A-Za-z0-9]+/,
  /\.netrc(\b|$)/,
  /\.pgpass(\b|$)/,
  /\.npmrc(\b|$)/,
  /\.secrets([./]|$)/,
  /(^|[/\\"'])credentials(\.|$|[/\\"'])/,
];

function isCredentialPath(path: string): boolean {
  return CREDENTIAL_PATTERNS.some((p) => p.test(path));
}

const CREDENTIAL_READERS = new Set([
  "cat", "awk", "grep", "sed", "head", "tail",
  "less", "more", "tac", "nl", "od",
  "strings", "xxd", "hexdump",
  "vim", "vi", "nano", "emacs",
  "cp", "mv", "rsync", "scp",
]);

function readsCredentialFile(tokens: string[]): boolean {
  let i = 0;
  // Skip leading env-var assignments (lowercase is valid: http_proxy=…).
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) i++;
  if (i >= tokens.length || !CREDENTIAL_READERS.has(tokens[i])) return false;
  for (let j = i + 1; j < tokens.length; j++) {
    const t = tokens[j];
    if (t.startsWith("-") && t !== "--") continue;
    if (isCredentialPath(t)) return true;
  }
  return false;
}

function detectSecretAccess(call: ToolCall): string | null {
  if (call.path && isCredentialPath(call.path)) {
    return `Refused — credential file read: ${call.path.slice(0, 80)}`;
  }
  if (call.command && anyPipeline(call.command, (stages) => stages.some((s) => readsCredentialFile(tokenize(s))))) {
    return `Refused — bash command reads a credential file: ${truncate(call.command)}`;
  }
  return null;
}

// ── no-git-destructive ───────────────────────────────────────────────────

function isForceFlag(token: string): boolean {
  // --force, --force-with-lease[=ref], -f, and merged short clusters (-fv, -vf).
  return (
    token === "--force" ||
    token.startsWith("--force-with-lease") ||
    /^-[a-zA-Z]*f[a-zA-Z]*$/.test(token)
  );
}

function isGitDestructive(tokens: string[]): boolean {
  const gitIdx = tokens.findIndex((t) => t === "git" || t.endsWith("/git"));
  if (gitIdx === -1) return false;
  const after = tokens.slice(gitIdx + 1);
  // Hook / signature bypass on any git command.
  if (after.some((t) => t === "--no-verify" || t === "--no-gpg-sign")) return true;
  // Force-push (any flag form).
  if (after.includes("push") && after.some(isForceFlag)) return true;
  // Hard reset — destroys uncommitted work and rewinds the branch.
  if (after.includes("reset") && after.includes("--hard")) return true;
  // Force-clean — permanently deletes untracked files (-f, -fd, -xf, …).
  if (after.includes("clean") && after.some((t) => /^-[a-z]*f/.test(t) || t === "--force")) return true;
  // Amend-in-place of a (likely pushed) commit — rewrites shared history.
  if (after.includes("commit") && after.includes("--amend") && after.includes("--no-edit")) return true;
  return false;
}

function detectGitDestructive(call: ToolCall): string | null {
  if (call.command && anyPipeline(call.command, (stages) => stages.some((s) => isGitDestructive(tokenize(s))))) {
    return `Refused — destructive git command rewrites history or destroys work; make a new commit / hand off to the user: ${truncate(call.command)}`;
  }
  return null;
}

// ── no-curl-pipe-shell ───────────────────────────────────────────────────

const INTERPRETERS = new Set([
  "bash", "sh", "zsh", "ksh", "fish", "dash",
  "python", "python3", "node", "deno", "bun",
  "ruby", "perl", "sudo",
]);

const isCurlOrWget = (stage: string): boolean => ["curl", "wget"].includes(leadingWord(stage));
const isInterpreter = (stage: string): boolean => INTERPRETERS.has(leadingWord(stage));

/** A curl/wget stage with an interpreter stage downstream in the same pipeline. */
function curlPipedToInterpreter(stages: string[]): boolean {
  for (let i = 0; i < stages.length; i++) {
    if (!isCurlOrWget(stages[i])) continue;
    for (let j = i + 1; j < stages.length; j++) {
      if (isInterpreter(stages[j])) return true;
    }
  }
  return false;
}

/** An interpreter stage that process-substitutes a curl/wget: `bash <(curl …)`. */
function interpreterProcessSubstitutesCurl(stage: string): boolean {
  if (!isInterpreter(stage)) return false;
  const procSub = /<\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;
  let m: RegExpExecArray | null;
  while ((m = procSub.exec(stage)) !== null) {
    if (isCurlOrWget(m[1])) return true;
  }
  return false;
}

function detectCurlPipeShell(call: ToolCall): string | null {
  if (
    call.command &&
    anyPipeline(call.command, (stages) => curlPipedToInterpreter(stages) || stages.some(interpreterProcessSubstitutesCurl))
  ) {
    return `Refused — remote download piped to an interpreter: ${truncate(call.command)}`;
  }
  return null;
}

// ── no-broad-rm ──────────────────────────────────────────────────────────

// `.` and `..` are deliberately omitted — `find . -name "*.pyc" -delete` is a
// common, safe cleanup pattern that should not be blocked.
const BROAD_TARGETS = new Set([
  "/", "~", "*",
  "$HOME", "${HOME}",
  "~/", "$HOME/", "${HOME}/",
]);

function isBroadTarget(token: string): boolean {
  const normalized = token.replace(/\/+$/, "");
  return BROAD_TARGETS.has(token) || BROAD_TARGETS.has(normalized);
}

function rmHitsBroadTarget(tokens: string[]): boolean {
  const rmIdx = tokens.indexOf("rm");
  if (rmIdx === -1) return false;
  for (let i = rmIdx + 1; i < tokens.length; i++) {
    if (tokens[i].startsWith("-")) continue;
    if (isBroadTarget(tokens[i])) return true;
  }
  return false;
}

// find global options that take a value, which can precede the path.
const FIND_VALUE_FLAGS = new Set(["-maxdepth", "-mindepth"]);

function findDeletesBroadTarget(tokens: string[]): boolean {
  const findIdx = tokens.indexOf("find");
  if (findIdx === -1) return false;
  let pathIdx = findIdx + 1;
  while (pathIdx < tokens.length && tokens[pathIdx].startsWith("-")) {
    if (FIND_VALUE_FLAGS.has(tokens[pathIdx])) pathIdx++; // also skip the flag's value
    pathIdx++;
  }
  if (pathIdx >= tokens.length || !isBroadTarget(tokens[pathIdx])) return false;
  for (let i = findIdx; i < tokens.length; i++) {
    if (tokens[i] === "-delete") return true;
    if (tokens[i] === "-exec" && tokens[i + 1] === "rm") return true;
  }
  return false;
}

function detectBroadRm(call: ToolCall): string | null {
  if (
    call.command &&
    anyPipeline(call.command, (stages) =>
      stages.some((s) => {
        const tokens = tokenize(s);
        return rmHitsBroadTarget(tokens) || findDeletesBroadTarget(tokens);
      }),
    )
  ) {
    return `Refused — recursive delete against a broad target: ${truncate(call.command)}`;
  }
  return null;
}

// ── no-sudo ──────────────────────────────────────────────────────────────

// `\bsudo\s` — sudo as a word followed by whitespace (the invocation shape).
// A regex over the whole command inherently covers wrappers and nesting.
const SUDO_PATTERN = /\bsudo\s/;

function detectSudo(call: ToolCall): string | null {
  if (call.command && SUDO_PATTERN.test(call.command)) {
    return `Refused — sudo privilege escalation: ${truncate(call.command)}`;
  }
  return null;
}

// ── migrated destructive-command policies ────────────────────────────────

// Each is a faithful migration of a former TTSR rule: a set of command
// patterns and a refusal reason carrying the rule's "right approach". The
// `[^|;&\n]*` segments keep a match inside one command.
function commandMatches(call: ToolCall, patterns: RegExp[]): boolean {
  return !!call.command && patterns.some((p) => p.test(call.command!));
}

const CLOUD_DESTROY_PATTERNS = [
  /aws\s+\S+\s+(?:delete|terminate)-[a-z-]+/,
  /terraform\s+(?:apply|destroy)\b/,
  /gcloud\b[^|;&\n]*\bdelete\b/,
  /kubectl\s+delete\b/,
];
function detectCloudDestroy(call: ToolCall): string | null {
  return commandMatches(call, CLOUD_DESTROY_PATTERNS)
    ? `Refused — destroys shared infrastructure; hand the command to the user (or produce a plan to review): ${truncate(call.command!)}`
    : null;
}

const DEPLOY_PATTERNS = [
  /make\s+(?:apply|deploy[a-z-]*|push-(?:to-prod|staging|live|release)[a-z-]*)\b/,
  /npm\s+run\s+deploy\b/,
  /(?:yarn|pnpm)\s+deploy\b/,
  /cap\s+\S+\s+deploy\b/,
  /fly\s+deploy\b/,
  /vercel\s+(?:--prod\b|deploy\s+--prod\b)/,
  /wrangler\s+deploy\b/,
  /(?:sls|serverless)\s+deploy\b/,
  /kubectl\s+apply\b/,
  /helm\s+(?:install|upgrade)\b/,
];
function detectDeploy(call: ToolCall): string | null {
  return commandMatches(call, DEPLOY_PATTERNS)
    ? `Refused — changes a production/shared environment; the user should run the deploy: ${truncate(call.command!)}`
    : null;
}

const DB_MUTATION_PATTERNS = [
  /\b(?:psql|mysql|mariadb|sqlite3?|mongo(?:sh)?|redis-cli)\b[^|;&\n]*\b(?:DROP|TRUNCATE|ALTER\s+TABLE|DELETE\s+FROM)\b/i,
  /\b(?:psql|mysql|mariadb|sqlite3?)\b[^|;&\n]*\bUPDATE\s+\w+\s+SET\b/i,
  /\b(?:psql|mysql|mariadb)\b[^|;&\n]*\s<\s*\S+\.sql/,
];
function detectDbMutation(call: ToolCall): string | null {
  return commandMatches(call, DB_MUTATION_PATTERNS)
    ? `Refused — mutates shared database state via a CLI; use a migration tool or hand the statement to the user: ${truncate(call.command!)}`
    : null;
}

const DD_DISK_PATTERNS = [
  /\bdd\s[^|;&\n]*\bof=\/dev\//,
  /\bdd\s[^|;&\n]*\bif=\/dev\//,
];
function detectDdDisk(call: ToolCall): string | null {
  return commandMatches(call, DD_DISK_PATTERNS)
    ? `Refused — dd against a raw device can overwrite a disk irreversibly; the user should run it after checking the device name: ${truncate(call.command!)}`
    : null;
}

const BROAD_CHMOD_PATTERNS = [
  // Broad target itself (optionally a single trailing slash) — NOT a subpath
  // like /home/deploy/app, which is the safe "name the exact dir" case.
  /\bchmod\s+-[a-zA-Z]*[Rr][a-zA-Z]*\s+\S+\s+(?:\/|~|\$HOME|\/etc|\/usr|\/var|\/opt|\/Users|\/home)\/?(?:\s|$)/,
  /\bchmod\s+-[a-zA-Z]*[Rr][a-zA-Z]*\s+\S+\s+\*(?:\s|$)/,
];
function detectBroadChmod(call: ToolCall): string | null {
  return commandMatches(call, BROAD_CHMOD_PATTERNS)
    ? `Refused — recursive chmod against a broad target can brick the system; name the exact path(s) instead: ${truncate(call.command!)}`
    : null;
}

// ── registry → detector wiring ───────────────────────────────────────────

const DETECTORS: Record<string, Detector> = {
  "no-secret-access": detectSecretAccess,
  "no-hardcoded-secret": detectHardcodedSecret,
  "no-shell-write": detectShellWrite,
  "no-git-destructive": detectGitDestructive,
  "no-curl-pipe-shell": detectCurlPipeShell,
  "no-broad-rm": detectBroadRm,
  "no-sudo": detectSudo,
  "no-cloud-destroy": detectCloudDestroy,
  "no-deploy": detectDeploy,
  "no-db-mutation": detectDbMutation,
  "no-dd-disk": detectDdDisk,
  "no-broad-chmod": detectBroadChmod,
};

export function evaluate(call: ToolCall): Verdict | null {
  for (const policy of POLICIES) {
    const detect = DETECTORS[policy.id];
    if (!detect) continue;
    const reason = detect(call);
    if (reason) return { policy: policy.id, reason };
  }
  return null;
}
