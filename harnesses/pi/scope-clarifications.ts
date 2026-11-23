import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ScopeEvidence, ScopeClarification } from "../../guard/semantic-scope";
import type { QuestionInput, Result } from "./ask-user-question";

const ENTRY = "ai-config.native-scope-clarification";
const LIMIT = 4096;
const INVALID = "Cannot establish native clarification evidence.";
const text = (value: unknown, limit: number): value is string => typeof value === "string" && value.length <= limit && !!value.trim();
const keys = (value: object, allowed: string[]) => Object.keys(value).every(key => allowed.includes(key));
type Receipt = { version: 1; callEntryId: string; toolCallId: string; question: string; answer: string; choice_description?: string };

function valid(value: any): value is Receipt {
  return value && typeof value === "object" && keys(value, ["version", "callEntryId", "toolCallId", "question", "answer", "choice_description"]) &&
    value.version === 1 && text(value.callEntryId, 256) && text(value.toolCallId, 256) && text(value.question, 2000) &&
    text(value.answer, 4000) && (value.choice_description === undefined || text(value.choice_description, 1000));
}

function isCall(entry: any, id: string): boolean {
  const content = entry?.type === "message" && entry.message?.role === "assistant" && entry.message.content;
  return Array.isArray(content) && content.length <= 512 && content.some(block =>
    block?.type === "toolCall" && block.name === "ask_user_question" && block.id === id);
}

/** Only the owned UI execution path writes this host-session record, never tool-result parsing. */
export function retainClarification(pi: Pick<ExtensionAPI, "appendEntry">, ctx: Pick<ExtensionContext, "sessionManager">,
  toolCallId: string, input: QuestionInput, result: Result): void {
  if (result.status !== "answered") return;
  const branch = ctx.sessionManager.getBranch().slice(-LIMIT);
  const source = branch.findLast(entry => isCall(entry, toolCallId));
  const answer = result.answer;
  const value: Receipt = { version: 1, callEntryId: source?.id ?? "", toolCallId, question: result.question,
    answer: answer.kind === "text" ? answer.text : answer.label,
    ...(answer.kind === "choice" ? { choice_description: input.options?.[answer.index]?.description } : {}) };
  if (!valid(value)) throw Error(INVALID);
  pi.appendEntry(ENTRY, value);
}

export function nativeScopeEvidence(entries: readonly any[], requestsFor: (entries: any[]) => string[]): ScopeEvidence {
  const branch = entries.slice(-LIMIT);
  const requests: { index: number; text: string }[] = [];
  for (let index = branch.length - 1; index >= 0 && requests.length < 8; index--) {
    const text = requestsFor([branch[index]])[0];
    if (text) requests.unshift({ index, text });
  }
  const evidence: ScopeEvidence = { user_requests: requests.map(request => request.text) };
  const byId = new Map(branch.map((entry, index) => [entry.id, { entry, index }]));
  const clarifications: ScopeClarification[] = [];
  for (let index = requests[0]?.index ?? branch.length; index < branch.length; index++) {
    const entry = branch[index];
    if (entry.type !== "custom" || entry.customType !== ENTRY) continue;
    const value = entry.data;
    if (!valid(value)) throw Error(INVALID);
    const source = byId.get(value.callEntryId);
    if (!source || source.index >= index || !isCall(source.entry, value.toolCallId)) throw Error(INVALID);
    clarifications.push({ question: value.question, answer: value.answer,
      ...(value.choice_description === undefined ? {} : { choice_description: value.choice_description }),
      after_request: requests.filter(request => request.index < index).length - 1 });
    if (clarifications.length > 8) clarifications.shift();
  }
  if (clarifications.length) evidence.clarifications = clarifications;
  return evidence;
}
