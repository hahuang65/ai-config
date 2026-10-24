// harnesses/pi/ask-user-question.ts
import { Type } from "typebox";
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
  const text = JSON.stringify(value).replace(/\p{Cc}/gu, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  return { content: [{ type: "text", text }], details: value, structuredContent: value };
}
var display = (text) => text.replace(/\p{Cc}/gu, " ");
async function textAnswer(question, signal, ctx) {
  const text = await ctx.ui.input(display(question), "Your answer", { signal });
  if (signal?.aborted)
    return respond({ status: "cancelled", question, reason: "aborted" });
  if (text === undefined)
    return respond({ status: "cancelled", question, reason: "dismissed" });
  if (typeof text !== "string" || text.length > 4000) {
    return respond({ status: "unavailable", question, reason: "invalid_response" });
  }
  if (!text.trim())
    return respond({ status: "cancelled", question, reason: "empty" });
  return respond({ status: "answered", question, answer: { kind: "text", text } });
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
  function register(exposure) {
    pi.registerTool({
      name: "ask_user_question",
      label: "Ask a question",
      exposure,
      description: "Ask one brief clarification question about requirements or preferences. " + "Supply 2–4 choices with trade-offs or omit options for free text. A choice question always permits a custom answer. " + "Use only for real intent decisions, not routine checkpoints, and wait for the answer before choosing another question. " + "Do not request secrets. Not an artifact approval, finding decision, or authorization to commit, install, deliver, or publish. " + "Ask in ordinary chat if unavailable. Never treat cancellation as an answer or repeatedly reopen a dismissed question.",
      parameters,
      outputSchema: output,
      executionMode: "sequential",
      async execute(_id, input, signal, _update, ctx) {
        try {
          return await choose(input, signal, ctx);
        } catch {
          return signal?.aborted ? respond({ status: "cancelled", question: input.question, reason: "aborted" }) : respond({ status: "unavailable", question: input.question, reason: "ui_error" });
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
