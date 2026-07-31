const CHANGE_REVIEW_AGENTS = new Set([
  "change-reviewer",
  "database-reviewer",
  "fact-checker",
]);

export function resolveAgentModel(
  agentName: string,
  configuredModel: string | undefined,
  environment: Record<string, string | undefined> = process.env,
): string | undefined {
  if (environment.CHANGE_REVIEW_GATE !== "1" || !CHANGE_REVIEW_AGENTS.has(agentName)) {
    return configuredModel;
  }
  return environment.CHANGE_REVIEW_SUBAGENT_MODEL || undefined;
}
