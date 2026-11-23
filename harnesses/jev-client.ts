import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { containsSecretLiteral } from "../guard/secret-literals.ts";

export const JEV_MODEL = "jev-1.14.0";
export const JEV_TIMEOUT_MS = 5000;
export type JevQuestion = { type: "bool"; instructions: string; criteria: { true: string; false: string } };
export type JevRequest = { state: Record<string, unknown>; questions: Record<string, JevQuestion> };
export type Judgment = { status: "ok" | "unavailable"; model: string; probabilities: Record<string, number>;
  inputTokens: number | null; outputTokens: number | null; elapsedMs: number };
type Registry = Pick<ExtensionContext["modelRegistry"], "findOfType" | "classify">;

export const condition = (instructions: string): JevQuestion => ({ type: "bool", instructions,
  criteria: { true: "The supplied evidence supports this condition.", false: "The supplied evidence does not support this condition." } });

export function unavailable(elapsedMs = 0): Judgment {
  return { status: "unavailable", model: JEV_MODEL, probabilities: {}, inputTokens: null, outputTokens: null, elapsedMs };
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let abort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("Jev advisory cancelled"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try { return await Promise.race([work, stopped]); }
  finally { signal.removeEventListener("abort", abort); }
}

export async function classifyJev(registry: Registry, request: JevRequest, parent?: AbortSignal): Promise<Judgment> {
  const started = performance.now();
  try {
    const keys = Object.keys(request.questions);
    const serialized = JSON.stringify(request);
    if (!keys.length || keys.length > 64 || Buffer.byteLength(serialized) > 32768 || containsSecretLiteral(serialized)) return unavailable();
    const signal = AbortSignal.any([AbortSignal.timeout(JEV_TIMEOUT_MS), ...(parent ? [parent] : [])]);
    signal.throwIfAborted();
    const model = registry.findOfType("classifier", "typesafe", "jev-latest");
    if (!model) return unavailable();
    const result = await abortable(registry.classify({ ...model, id: JEV_MODEL }, request, { signal }), signal);
    if (result.stopReason !== "stop" || result.model !== JEV_MODEL || Object.keys(result.answers).length !== keys.length) return unavailable();
    const probabilities: Record<string, number> = {};
    for (const key of keys) {
      const answer = result.answers[key];
      if (answer?.type !== "bool" || !Number.isFinite(answer.probability) || answer.probability < 0 || answer.probability > 1) return unavailable();
      probabilities[key] = answer.probability;
    }
    const tokens = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
    return { status: "ok", model: JEV_MODEL, probabilities, inputTokens: tokens(result.usage?.input),
      outputTokens: tokens(result.usage?.output), elapsedMs: Math.round(performance.now() - started) };
  } catch { return unavailable(Math.round(performance.now() - started)); }
}
