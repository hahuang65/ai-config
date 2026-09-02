import type { JsonRecord } from "./types.ts";
import { assertSafeAuthentication } from "./support.ts";

const DEFAULT_URL = "http://localhost:3111";
const REQUEST_TIMEOUT_MS = 5_000;

export class AgentMemoryClient {
  private readonly baseUrl: string;

  constructor(
    private readonly request: typeof globalThis.fetch,
    configuredUrl?: string,
    private readonly secret?: string,
  ) {
    this.baseUrl = (configuredUrl || DEFAULT_URL).replace(/\/+$/, "");
  }

  async call(
    pathname: string,
    options: { method?: string; body?: unknown } = {},
  ): Promise<JsonRecord | null> {
    assertSafeAuthentication(this.baseUrl, this.secret);
    const headers: Record<string, string> = {};
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.secret) headers.Authorization = `Bearer ${this.secret}`;
    try {
      const response = await this.request(
        `${this.baseUrl}/agentmemory/${pathname.replace(/^\/+/, "")}`,
        {
          method: options.method ?? "POST",
          headers,
          body: options.body === undefined ? undefined : JSON.stringify(options.body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );
      if (!response.ok) return null;
      return await response.json() as JsonRecord;
    } catch {
      return null;
    }
  }
}
