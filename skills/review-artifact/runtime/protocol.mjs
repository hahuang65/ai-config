import { randomBytes, timingSafeEqual } from "node:crypto";

export const REVIEW_ARTIFACT_APP = "review-artifact";
export const REVIEW_ARTIFACT_RUNTIME_VERSION = 6;
export const AGENT_TOKEN_HEADER = "x-review-artifact-agent-token";
export const REVIEW_PURPOSES = Object.freeze(["feedback", "approval", "decision"]);
export const REVIEW_MODES = Object.freeze(["annotate", "explore"]);

const AGENT_TOKEN_BYTES = 32;

export function createAgentToken() {
  return randomBytes(AGENT_TOKEN_BYTES).toString("hex");
}

export function agentTokenMatches(candidate, expected) {
  if (typeof candidate !== "string" || typeof expected !== "string") return false;
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}
