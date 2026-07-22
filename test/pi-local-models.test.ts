import { test, expect } from "bun:test";
import registerLocalModels, {
  LOCAL_SERVERS,
  discoverLocalProviders,
} from "../harnesses/pi/extensions/local-models";

// Drive the extension the way pi would: hand it a fake ExtensionAPI and a fake
// fetch, then inspect what it registered. Mirrors the pi-adapter test idiom.
// The fake fetch serves canned JSON per exact URL; a function value lets a
// route respond based on the parsed request body (Ollama's /api/show).

type RegisteredProvider = { name: string; config: any };
type RouteResponder = unknown | ((requestBody: unknown) => unknown);

function fetchWithRoutes(routes: Record<string, RouteResponder>) {
  return async (url: string, init?: { body?: string }): Promise<Response> => {
    const responder = routes[String(url)];
    if (responder === undefined) throw new Error(`connection refused: ${url}`);
    const requestBody = init?.body ? JSON.parse(init.body) : undefined;
    const payload =
      typeof responder === "function" ? responder(requestBody) : responder;
    return { ok: true, json: async () => payload } as Response;
  };
}

async function runExtension(routes: Record<string, RouteResponder>) {
  const registered: RegisteredProvider[] = [];
  const pi = {
    registerProvider: (name: string, config: unknown) =>
      registered.push({ name, config }),
  };
  await registerLocalModels(pi as any, fetchWithRoutes(routes));
  return registered;
}

const OLLAMA_BASE_URL = LOCAL_SERVERS.find((s) => s.provider === "ollama")!.baseUrl;
const LLAMACPP_BASE_URL = LOCAL_SERVERS.find((s) => s.provider === "llamacpp")!.baseUrl;
const OLLAMA_ROOT = OLLAMA_BASE_URL.replace(/\/v1$/, "");
const LLAMACPP_ROOT = LLAMACPP_BASE_URL.replace(/\/v1$/, "");

function modelListing(entries: Array<Record<string, unknown>>) {
  return { object: "list", data: entries };
}

test("registers an ollama provider with one model per listed id", async () => {
  const registered = await runExtension({
    [`${OLLAMA_BASE_URL}/models`]: modelListing([
      { id: "llama3.1:8b" },
      { id: "qwen2.5-coder:7b" },
    ]),
  });
  expect(registered).toHaveLength(1);
  expect(registered[0].name).toBe("ollama");
  expect(registered[0].config.models.map((m: any) => m.id)).toEqual([
    "llama3.1:8b",
    "qwen2.5-coder:7b",
  ]);
});

test("registers a llamacpp provider pointing at the llama.cpp base url", async () => {
  const registered = await runExtension({
    [`${LLAMACPP_BASE_URL}/models`]: modelListing([{ id: "qwen2.5-coder-32b" }]),
  });
  expect(registered[0].name).toBe("llamacpp");
});

test("registers both providers when both servers respond", async () => {
  const registered = await runExtension({
    [`${OLLAMA_BASE_URL}/models`]: modelListing([{ id: "llama3.1:8b" }]),
    [`${LLAMACPP_BASE_URL}/models`]: modelListing([{ id: "qwen2.5-coder-32b" }]),
  });
  expect(registered.map((r) => r.name).sort()).toEqual(["llamacpp", "ollama"]);
});

test("registers nothing when no local server responds", async () => {
  const registered = await runExtension({});
  expect(registered).toHaveLength(0);
});

test("skips a server whose model listing is empty", async () => {
  const registered = await runExtension({
    [`${OLLAMA_BASE_URL}/models`]: modelListing([]),
  });
  expect(registered).toHaveLength(0);
});

test("marks local models as free so usage tracking shows zero cost", async () => {
  const registered = await runExtension({
    [`${OLLAMA_BASE_URL}/models`]: modelListing([{ id: "llama3.1:8b" }]),
  });
  expect(registered[0].config.models[0].cost).toEqual({
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
  });
});

test("disables developer role and reasoning effort for local servers", async () => {
  const registered = await runExtension({
    [`${LLAMACPP_BASE_URL}/models`]: modelListing([{ id: "some-model" }]),
  });
  expect(registered[0].config.models[0].compat).toEqual({
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
  });
});

test("discoverLocalProviders tolerates a listing with malformed entries", async () => {
  const providers = await discoverLocalProviders(
    fetchWithRoutes({
      [`${OLLAMA_BASE_URL}/models`]: modelListing([
        { id: "good-model" },
        { notAnId: true },
      ]),
    }),
  );
  expect(providers[0].config.models.map((m: any) => m.id)).toEqual(["good-model"]);
});

// --- context-window resolution -----------------------------------------------

test("llamacpp uses the loaded n_ctx from /props over the trained context", async () => {
  const registered = await runExtension({
    [`${LLAMACPP_BASE_URL}/models`]: modelListing([
      { id: "some-model", meta: { n_ctx_train: 131072 } },
    ]),
    [`${LLAMACPP_ROOT}/props`]: {
      default_generation_settings: { n_ctx: 16384 },
    },
  });
  expect(registered[0].config.models[0].contextWindow).toBe(16384);
});

test("llamacpp falls back to the trained context when /props is unavailable", async () => {
  const registered = await runExtension({
    [`${LLAMACPP_BASE_URL}/models`]: modelListing([
      { id: "some-model", meta: { n_ctx_train: 131072 } },
    ]),
  });
  expect(registered[0].config.models[0].contextWindow).toBe(131072);
});

test("ollama uses the architecture context_length from /api/show", async () => {
  const registered = await runExtension({
    [`${OLLAMA_BASE_URL}/models`]: modelListing([{ id: "qwen3.6:27b" }]),
    [`${OLLAMA_ROOT}/api/show`]: {
      model_info: { "qwen3.context_length": 262144 },
    },
  });
  expect(registered[0].config.models[0].contextWindow).toBe(262144);
});

test("ollama prefers an explicit num_ctx parameter over the trained context", async () => {
  const registered = await runExtension({
    [`${OLLAMA_BASE_URL}/models`]: modelListing([{ id: "qwen3.6:27b" }]),
    [`${OLLAMA_ROOT}/api/show`]: {
      parameters: "num_ctx                        16384\nstop    <|im_end|>",
      model_info: { "qwen3.context_length": 262144 },
    },
  });
  expect(registered[0].config.models[0].contextWindow).toBe(16384);
});

test("ollama asks /api/show about each listed model by id", async () => {
  const requestedModelIds: string[] = [];
  await runExtension({
    [`${OLLAMA_BASE_URL}/models`]: modelListing([
      { id: "llama3.1:8b" },
      { id: "qwen3.6:27b" },
    ]),
    [`${OLLAMA_ROOT}/api/show`]: (requestBody: any) => {
      requestedModelIds.push(requestBody.model);
      return { model_info: {} };
    },
  });
  expect(requestedModelIds.sort()).toEqual(["llama3.1:8b", "qwen3.6:27b"]);
});

test("falls back to the default context window when /api/show fails", async () => {
  const registered = await runExtension({
    [`${OLLAMA_BASE_URL}/models`]: modelListing([{ id: "llama3.1:8b" }]),
  });
  expect(registered[0].config.models[0].contextWindow).toBe(32768);
});
