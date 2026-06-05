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

/** Quote-aware word split of a single command stage. */
export function tokenize(stage: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (const c of stage) {
    if (inSingle) {
      if (c === "'") inSingle = false;
      else current += c;
    } else if (inDouble) {
      if (c === '"') inDouble = false;
      else current += c;
    } else if (c === "'") {
      inSingle = true;
    } else if (c === '"') {
      inDouble = true;
    } else if (/\s/.test(c)) {
      if (current) { tokens.push(current); current = ""; }
    } else {
      current += c;
    }
  }
  if (current) tokens.push(current);
  return tokens;
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
    let m: RegExpExecArray | null;
    while ((m = re.exec(command)) !== null) found.push(m[1]);
  }
  return found;
}

/** Split a command into statements on `;`, `&&`/`&`, `||` outside quotes/parens. A single `|` is a pipe and stays within the statement. */
function splitStatements(command: string): string[] {
  const out: string[] = [];
  let cur = "";
  let parens = 0, sq = false, dq = false, bt = false;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (sq) { if (c === "'") sq = false; cur += c; continue; }
    if (dq) { if (c === '"') dq = false; cur += c; continue; }
    if (bt) { if (c === "`") bt = false; cur += c; continue; }
    if (c === "'") { sq = true; cur += c; continue; }
    if (c === '"') { dq = true; cur += c; continue; }
    if (c === "`") { bt = true; cur += c; continue; }
    if (c === "(") { parens++; cur += c; continue; }
    if (c === ")") { parens--; cur += c; continue; }
    if (parens === 0) {
      if (c === ";" || c === "&") { if (command[i + 1] === c) i++; out.push(cur); cur = ""; continue; }
      if (c === "|" && command[i + 1] === "|") { i++; out.push(cur); cur = ""; continue; }
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** Split a statement into pipeline stages on a single `|` (and `|&`). */
function splitPipeline(statement: string): string[] {
  const out: string[] = [];
  let cur = "";
  let parens = 0, sq = false, dq = false, bt = false;
  for (let i = 0; i < statement.length; i++) {
    const c = statement[i];
    if (sq) { if (c === "'") sq = false; cur += c; continue; }
    if (dq) { if (c === '"') dq = false; cur += c; continue; }
    if (bt) { if (c === "`") bt = false; cur += c; continue; }
    if (c === "'") { sq = true; cur += c; continue; }
    if (c === '"') { dq = true; cur += c; continue; }
    if (c === "`") { bt = true; cur += c; continue; }
    if (c === "(") { parens++; cur += c; continue; }
    if (c === ")") { parens--; cur += c; continue; }
    if (c === "|" && parens === 0) {
      out.push(cur); cur = "";
      if (statement[i + 1] === "&") i++; // bash's `|&`
      continue;
    }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
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
