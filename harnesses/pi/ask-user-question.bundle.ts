// harnesses/pi/ask-user-question.ts
import { Type } from "typebox";

// harnesses/pi/scope-clarifications.ts
var ENTRY = "ai-config.native-scope-clarification";
var LIMIT = 4096;
var INVALID = "Cannot establish native clarification evidence.";
var text = (value, limit) => typeof value === "string" && value.length <= limit && !!value.trim();
var keys = (value, allowed) => Object.keys(value).every((key) => allowed.includes(key));
function valid(value) {
  return value && typeof value === "object" && keys(value, ["version", "callEntryId", "toolCallId", "question", "answer", "choice_description"]) && value.version === 1 && text(value.callEntryId, 256) && text(value.toolCallId, 256) && text(value.question, 2000) && text(value.answer, 4000) && (value.choice_description === undefined || text(value.choice_description, 1000));
}
function isCall(entry, id) {
  const content = entry?.type === "message" && entry.message?.role === "assistant" && entry.message.content;
  return Array.isArray(content) && content.length <= 512 && content.some((block) => block?.type === "toolCall" && block.name === "ask_user_question" && block.id === id);
}
function retainClarification(pi, ctx, toolCallId, input, result) {
  if (result.status !== "answered")
    return;
  const branch = ctx.sessionManager.getBranch().slice(-LIMIT);
  const source = branch.findLast((entry) => isCall(entry, toolCallId));
  const answer = result.answer;
  const value = {
    version: 1,
    callEntryId: source?.id ?? "",
    toolCallId,
    question: result.question,
    answer: answer.kind === "text" ? answer.text : answer.label,
    ...answer.kind === "choice" ? { choice_description: input.options?.[answer.index]?.description } : {}
  };
  if (!valid(value))
    throw Error(INVALID);
  pi.appendEntry(ENTRY, value);
}

// harnesses/pi/ask-user-question.ts
var parameters = Type.Object({
  question: Type.String({ minLength: 1, maxLength: 2000, pattern: "\\S" }),
  options: Type.Optional(Type.Array(Type.Object({
    label: Type.String({ minLength: 1, maxLength: 100, pattern: "\\S" }),
    description: Type.String({ minLength: 1, maxLength: 1000, pattern: "\\S" })
  }, { additionalProperties: false }), { minItems: 2, maxItems: 4 }))
}, { additionalProperties: false });
var output = Type.Union([
  Type.Object({ status: Type.Literal("answered"), question: Type.String(), answer: Type.Union([
    Type.Object({ kind: Type.Literal("choice"), index: Type.Integer({ minimum: 0 }), label: Type.String() }),
    Type.Object({ kind: Type.Literal("text"), text: Type.String({ minLength: 1, maxLength: 4000 }) })
  ]) }),
  Type.Object({ status: Type.Literal("cancelled"), question: Type.String(), reason: Type.String() }),
  Type.Object({ status: Type.Literal("unavailable"), question: Type.String(), reason: Type.String() })
]);
function respond(value) {
  const text2 = JSON.stringify(value).replace(/\p{Cc}/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return { content: [{ type: "text", text: text2 }], details: value, structuredContent: value };
}
var display = (text2) => text2.replace(/\p{Cc}/gu, " ");
async function textAnswer(question, signal, ctx) {
  const text2 = await ctx.ui.input(display(question), "Your answer", { signal });
  if (signal?.aborted)
    return respond({ status: "cancelled", question, reason: "aborted" });
  if (text2 === undefined)
    return respond({ status: "cancelled", question, reason: "dismissed" });
  if (typeof text2 !== "string" || text2.length > 4000) {
    return respond({ status: "unavailable", question, reason: "invalid_response" });
  }
  if (!text2.trim())
    return respond({ status: "cancelled", question, reason: "empty" });
  return respond({ status: "answered", question, answer: { kind: "text", text: text2 } });
}
async function choose(input, signal, ctx) {
  if (signal?.aborted)
    return respond({ status: "cancelled", question: input.question, reason: "aborted" });
  if (!ctx.hasUI)
    return respond({ status: "unavailable", question: input.question, reason: "no_ui" });
  const options = input.options ?? [];
  if (!options.length)
    return textAnswer(input.question, signal, ctx);
  const labels = options.map((option, index2) => `${index2 + 1}. ${display(option.label)}`);
  const title = [display(input.question), ...options.map((option, index2) => `${labels[index2]} — ${display(option.description)}`)].join(`

`);
  const custom = "Type my own answer...";
  const selection = await ctx.ui.select(title, [...labels, custom], { signal });
  if (signal?.aborted)
    return respond({ status: "cancelled", question: input.question, reason: "aborted" });
  if (selection === undefined)
    return respond({ status: "cancelled", question: input.question, reason: "dismissed" });
  if (selection === custom)
    return textAnswer(input.question, signal, ctx);
  const index = labels.indexOf(selection);
  if (index < 0)
    return respond({ status: "unavailable", question: input.question, reason: "invalid_response" });
  return respond({
    status: "answered",
    question: input.question,
    answer: { kind: "choice", index, label: options[index].label }
  });
}
function questions(pi) {
  const semanticEnabled = process.env.AI_JEV_SCOPE === "1";
  function register(exposure) {
    pi.registerTool({
      name: "ask_user_question",
      label: "Ask a question",
      exposure,
      description: "Ask one brief clarification question about requirements or preferences. " + "Supply 2–4 choices with trade-offs or omit options for free text. A choice question always permits a custom answer. " + "Use only for real intent decisions, not routine checkpoints, and wait for the answer before choosing another question. " + "Do not request secrets. Not an artifact approval, finding decision, or authorization to commit, install, deliver, or publish. " + "Ask in ordinary chat if unavailable. Never treat cancellation as an answer or repeatedly reopen a dismissed question.",
      parameters,
      outputSchema: output,
      executionMode: "sequential",
      async execute(id, input, signal, _update, ctx) {
        const waiting = ctx.mode === "tui" && ctx.hasUI && !signal?.aborted;
        if (waiting)
          pi.events.emit("herdr:blocked", { active: true, label: "Waiting for your answer" });
        try {
          const result = await choose(input, signal, ctx);
          if (semanticEnabled && !signal?.aborted)
            retainClarification(pi, ctx, id, input, result.details);
          return result;
        } catch {
          return signal?.aborted ? respond({ status: "cancelled", question: input.question, reason: "aborted" }) : respond({ status: "unavailable", question: input.question, reason: "ui_error" });
        } finally {
          if (waiting)
            pi.events.emit("herdr:blocked", { active: false });
        }
      }
    });
  }
  register("model-only");
  pi.on("session_start", (_event, ctx) => {
    if (!ctx.hasUI)
      register("hidden");
  });
}
export {
  questions as default
};
