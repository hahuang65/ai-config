// bash-command.ts
//
// A small deep module: walk a bash command string into the structure the
// guardrail detectors query. All the quote / paren / separator / substitution
// complexity lives here once — `anyPipeline` visits each pipeline's ordered
// stages across every statement and recursively inside process/command
// substitutions, short-circuiting on the first match. Detectors become
// predicates over stages; `tokenize` and `leadingWord` are exposed for them.
//
// Replaces the per-detector copies of split-then-tokenize-then-recurse that
// previously lived in guard-core.ts (one traversal, not three).

export interface TokenizedStage {
  malformed: boolean;
  tokens: string[];
}

type ShellQuote = "double" | "none" | "single" | "backtick";

const DOUBLE_QUOTE_ESCAPES = new Set(["$", "`", '"', "\\", "\n"]);

function pushToken(tokens: string[], current: string, started: boolean): void {
  if (started) tokens.push(current);
}

/** Shell-aware word split and escape normalization of a single command stage. */
export function tokenizeDetailed(stage: string): TokenizedStage {
  const tokens: string[] = [];
  let current = "";
  let started = false;
  let quote: ShellQuote = "none";
  let malformed = false;
  for (let index = 0; index < stage.length; index += 1) {
    const character = stage[index];
    if (quote === "single") {
      if (character === "'") quote = "none";
      else current += character;
      continue;
    }
    if (quote === "double" && character === '"') {
      quote = "none";
      continue;
    }
    if (character === "\\" && quote !== "backtick") {
      const next = stage[index + 1];
      if (next === undefined) {
        current += character;
        malformed = true;
      } else if (quote === "none" || DOUBLE_QUOTE_ESCAPES.has(next)) {
        if (next !== "\n") current += next;
        started = true;
        index += 1;
      } else {
        current += character;
      }
      continue;
    }
    if (quote === "none" && character === "'") {
      quote = "single";
      started = true;
    } else if (quote === "none" && character === '"') {
      quote = "double";
      started = true;
    } else if (quote === "none" && /\s/.test(character)) {
      pushToken(tokens, current, started);
      current = "";
      started = false;
    } else {
      current += character;
      started = true;
    }
  }
  pushToken(tokens, current, started);
  return { malformed: malformed || quote !== "none", tokens };
}

/** Shell-aware word split of a single command stage. */
export function tokenize(stage: string): string[] {
  return tokenizeDetailed(stage).tokens;
}

/** First non-env-assignment word of a stage (skips `http_proxy=…` prefixes). */
export function leadingWord(stage: string): string {
  for (const token of tokenize(stage)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    return token;
  }
  return "";
}

/** Inner contents of process/command substitutions and backticks. */
function extractSubstitutions(command: string): string[] {
  const found: string[] = [];
  const patterns = [
    /[<>]\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g, // <(…) >(…)
    /\$\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g,    // $(…)
    /`([^`]+)`/g,                               // `…`
  ];
  for (const re of patterns) {
    let match = re.exec(command);
    while (match !== null) {
      found.push(match[1]);
      match = re.exec(command);
    }
  }
  return found;
}

function escapedPairLength(command: string, index: number, quote: ShellQuote): number {
  if (command[index] !== "\\" || quote === "single") return 0;
  const next = command[index + 1];
  if (next === undefined) return 0;
  if (quote === "none" || quote === "backtick" || DOUBLE_QUOTE_ESCAPES.has(next)) return 2;
  return 0;
}

function splitShell(command: string, separatorLength: (command: string, index: number) => number): string[] {
  const out: string[] = [];
  let current = "";
  let parentheses = 0;
  let quote: ShellQuote = "none";
  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    const escapedLength = escapedPairLength(command, index, quote);
    if (escapedLength > 0) {
      current += command.slice(index, index + escapedLength);
      index += escapedLength - 1;
      continue;
    }
    if (quote === "single") {
      if (character === "'") quote = "none";
    } else if (quote === "double") {
      if (character === '"') quote = "none";
    } else if (quote === "backtick") {
      if (character === "`") quote = "none";
    } else if (character === "'") quote = "single";
    else if (character === '"') quote = "double";
    else if (character === "`") quote = "backtick";
    else if (character === "(") parentheses += 1;
    else if (character === ")") parentheses -= 1;
    if (quote !== "none" || parentheses !== 0) {
      current += character;
      continue;
    }
    const length = separatorLength(command, index);
    if (length === 0) current += character;
    else {
      out.push(current);
      current = "";
      index += length - 1;
    }
  }
  if (current) out.push(current);
  return out;
}

/** Split a command into statements on `;`, `&&`/`&`, or `||` outside quotes/parens. A single `|` is a pipe and stays within the statement. */
export function splitStatements(command: string, splitNewlines = false): string[] {
  return splitShell(command, (input, index) => {
    const character = input[index];
    if (character === ";" || character === "&" || splitNewlines && character === "\n") {
      return input[index + 1] === character ? 2 : 1;
    }
    return character === "|" && input[index + 1] === "|" ? 2 : 0;
  });
}

/** Split a statement into pipeline stages on a single `|` (and `|&`). */
function splitPipeline(statement: string): string[] {
  return splitShell(statement, (input, index) => {
    if (input[index] !== "|" || input[index + 1] === "|") return 0;
    return input[index + 1] === "&" ? 2 : 1;
  });
}

/**
 * Visit each pipeline — an ordered list of its `|`-separated stage strings —
 * across every statement of `command` and recursively inside every
 * process/command substitution. Returns true as soon as `predicate` does.
 *
 * A flat invocation check is `anyPipeline(cmd, stages => stages.some(...))`;
 * a pipe-adjacency check reads the ordered `stages` directly.
 */
export function anyPipeline(command: string, predicate: (stages: string[]) => boolean): boolean {
  for (const statement of splitStatements(command)) {
    if (predicate(splitPipeline(statement))) return true;
  }
  for (const inner of extractSubstitutions(command)) {
    if (anyPipeline(inner, predicate)) return true;
  }
  return false;
}
