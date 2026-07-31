const REVIEW_CHANGE_AGENTS = new Set([
  "change-reviewer",
  "database-reviewer",
  "fact-checker",
]);

export function resolveAgentModel(
  agentName: string,
  configuredModel: string | undefined,
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  if (environment.REVIEW_CHANGE_GATE !== "1" || !REVIEW_CHANGE_AGENTS.has(agentName)) {
    return configuredModel;
  }
  return environment.REVIEW_CHANGE_SUBAGENT_MODEL || undefined;
}
