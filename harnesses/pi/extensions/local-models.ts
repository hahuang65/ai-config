// local-models.ts
//
// Auto-discovers local OpenAI-compatible model servers (Ollama, llama.cpp) and
// registers each responsive one as a pi provider. pi waits for async extension
// factories before startup finishes (docs/custom-provider.md), so discovered
// models appear in /model and `pi --list-models` with no static models.json.
//
// Context limits come from the most truthful source each server offers:
// llama.cpp's /props reports the actually-allocated n_ctx (--ctx-size), which
// can be far below the model's trained context; Ollama's /api/show reports a
// Modelfile num_ctx override or the architecture's trained context_length.
//
// Self-contained by design: pi does not realpath-resolve symlinked extensions,
// so this file must have no relative imports (type-only imports are erased at
// transpile). That lets install.sh symlink it directly, unlike the guard
// adapter which imports shared/ and therefore ships as a bundle.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface LocalServer {
  provider: string;
  kind: "ollama" | "llamacpp";
  displayName: string;
  baseUrl: string;
}

interface ListedModel {
  id: string;
  trainedContextWindow?: number;
}

interface DiscoveredModel {
  id: string;
  name: string;
  reasoning: boolean;
  input: string[];
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
  contextWindow: number;
  maxTokens: number;
  compat: { supportsDeveloperRole: boolean; supportsReasoningEffort: boolean };
}

interface DiscoveredProvider {
  name: string;
  config: {
    name: string;
    baseUrl: string;
    apiKey: string;
    api: "openai-completions";
    models: DiscoveredModel[];
  };
}

const DISCOVERY_TIMEOUT_MS = 1500;
const DEFAULT_CONTEXT_WINDOW = 32768;
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
// Local servers ignore auth, but pi hides models whose provider has no key
// (docs/models.md), so a placeholder is required.
const KEYLESS_PLACEHOLDER = "local";
const FREE_OF_CHARGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
// Ollama and llama.cpp are plain chat-completions servers: no `developer`
// role, no `reasoning_effort` (docs/models.md "OpenAI Compatibility").
const LOCAL_SERVER_COMPAT = {
  supportsDeveloperRole: false,
  supportsReasoningEffort: false,
};

export const LOCAL_SERVERS: readonly LocalServer[] = [
  {
    provider: "ollama",
    kind: "ollama",
    displayName: "Ollama (local)",
    baseUrl: process.env.PI_OLLAMA_BASE_URL ?? "http://127.0.0.1:11434/v1",
  },
  {
    provider: "llamacpp",
    kind: "llamacpp",
    displayName: "llama.cpp (local)",
    baseUrl: process.env.PI_LLAMACPP_BASE_URL ?? "http://127.0.0.1:8080/v1",
  },
];

type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<Response>;

function serverRootUrl(server: LocalServer): string {
  return server.baseUrl.replace(/\/v1\/?$/, "");
}

async function fetchModelListing(
  server: LocalServer,
  fetchFn: FetchLike,
): Promise<unknown[]> {
  const response = await fetchFn(`${server.baseUrl}/models`, {
    signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
  });
  if (!response.ok) return [];
  const listing = (await response.json()) as { data?: unknown[] };
  return Array.isArray(listing.data) ? listing.data : [];
}

function parseListedModel(rawEntry: unknown): ListedModel | undefined {
  if (typeof rawEntry !== "object" || rawEntry === null) return undefined;
  const entry = rawEntry as { id?: unknown; meta?: { n_ctx_train?: unknown } };
  if (typeof entry.id !== "string" || entry.id === "") return undefined;
  const trained = entry.meta?.n_ctx_train;
  return {
    id: entry.id,
    trainedContextWindow:
      typeof trained === "number" && trained > 0 ? trained : undefined,
  };
}

// llama.cpp: /props reports the context actually allocated at launch
// (--ctx-size, split across slots) — the binding limit for a request.
async function fetchLlamaCppLoadedContext(
  server: LocalServer,
  fetchFn: FetchLike,
): Promise<number | undefined> {
  try {
    const response = await fetchFn(`${serverRootUrl(server)}/props`, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const props = (await response.json()) as {
      default_generation_settings?: { n_ctx?: unknown };
    };
    const loadedContext = props.default_generation_settings?.n_ctx;
    return typeof loadedContext === "number" && loadedContext > 0
      ? loadedContext
      : undefined;
  } catch {
    return undefined;
  }
}

function numCtxFromParameters(parameters?: string): number | undefined {
  const numCtxLine = parameters?.match(/^num_ctx\s+(\d+)/m);
  return numCtxLine ? Number(numCtxLine[1]) : undefined;
}

function contextLengthFromModelInfo(
  modelInfo?: Record<string, unknown>,
): number | undefined {
  if (!modelInfo) return undefined;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith(".context_length") && typeof value === "number") return value;
  }
  return undefined;
}

// Ollama: /api/show exposes a Modelfile num_ctx override (the runtime limit,
// when set) and the architecture's trained context_length as a fallback.
async function fetchOllamaContextLimit(
  server: LocalServer,
  modelId: string,
  fetchFn: FetchLike,
): Promise<number | undefined> {
  try {
    const response = await fetchFn(`${serverRootUrl(server)}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) return undefined;
    const detail = (await response.json()) as {
      parameters?: string;
      model_info?: Record<string, unknown>;
    };
    return (
      numCtxFromParameters(detail.parameters) ??
      contextLengthFromModelInfo(detail.model_info)
    );
  } catch {
    return undefined;
  }
}

function toDiscoveredModel(
  listedModel: ListedModel,
  contextLimitOverride: number | undefined,
): DiscoveredModel {
  return {
    id: listedModel.id,
    name: listedModel.id,
    reasoning: false,
    input: ["text"],
    cost: FREE_OF_CHARGE,
    contextWindow:
      contextLimitOverride ??
      listedModel.trainedContextWindow ??
      DEFAULT_CONTEXT_WINDOW,
    maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    compat: LOCAL_SERVER_COMPAT,
  };
}

async function buildModels(
  server: LocalServer,
  rawListing: unknown[],
  fetchFn: FetchLike,
): Promise<DiscoveredModel[]> {
  const serverWideLimit =
    server.kind === "llamacpp"
      ? await fetchLlamaCppLoadedContext(server, fetchFn)
      : undefined;
  const models = await Promise.all(
    rawListing.map(async (rawEntry) => {
      const listedModel = parseListedModel(rawEntry);
      if (!listedModel) return undefined;
      const perModelLimit =
        server.kind === "ollama"
          ? await fetchOllamaContextLimit(server, listedModel.id, fetchFn)
          : undefined;
      return toDiscoveredModel(listedModel, serverWideLimit ?? perModelLimit);
    }),
  );
  return models.filter((model): model is DiscoveredModel => model !== undefined);
}

async function discoverServer(
  server: LocalServer,
  fetchFn: FetchLike,
): Promise<DiscoveredProvider | undefined> {
  let rawListing: unknown[];
  try {
    rawListing = await fetchModelListing(server, fetchFn);
  } catch {
    return undefined; // server not running — the normal case, skip silently
  }
  const models = await buildModels(server, rawListing, fetchFn);
  if (models.length === 0) return undefined;
  return {
    name: server.provider,
    config: {
      name: server.displayName,
      baseUrl: server.baseUrl,
      apiKey: KEYLESS_PLACEHOLDER,
      api: "openai-completions",
      models,
    },
  };
}

export async function discoverLocalProviders(
  fetchFn: FetchLike = fetch,
): Promise<DiscoveredProvider[]> {
  const probes = LOCAL_SERVERS.map((server) => discoverServer(server, fetchFn));
  const outcomes = await Promise.all(probes);
  return outcomes.filter(
    (provider): provider is DiscoveredProvider => provider !== undefined,
  );
}

export default async function (
  pi: ExtensionAPI,
  fetchFn: FetchLike = fetch,
): Promise<void> {
  const providers = await discoverLocalProviders(fetchFn);
  for (const provider of providers) {
    pi.registerProvider(provider.name, provider.config as never);
  }
}
