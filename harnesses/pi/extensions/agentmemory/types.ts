export type CaptureMode = "off" | "metadata" | "full";
export type RecallMode = "off" | "explicit";
export type JsonRecord = Record<string, unknown>;
export type GitReader = (args: string[], cwd: string) => string;

export type AgentMemoryEnvironment = {
  AGENTMEMORY_CAPTURE?: string;
  AGENTMEMORY_EXCLUDED_TOOLS?: string;
  AGENTMEMORY_POLICY_PATH?: string;
  AGENTMEMORY_PROJECT_NAME?: string;
  AGENTMEMORY_RECALL?: string;
  AGENTMEMORY_SECRET?: string;
  AGENTMEMORY_URL?: string;
};

export type AdapterDependencies = {
  environment?: AgentMemoryEnvironment;
  fetch?: typeof globalThis.fetch;
  git?: GitReader;
  now?: () => Date;
  projectIdentity?: (cwd: string) => string;
  randomUUID?: () => string;
};
