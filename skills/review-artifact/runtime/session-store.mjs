import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export function sessionKey(file) {
  return createHash("sha256").update(file).digest("hex").slice(0, 16);
}

export class SessionStore {
  constructor(file) {
    this.file = file;
    this.pendingMutation = Promise.resolve();
  }

  async upsert(file, url, { mode = "annotate", purpose = "feedback", reopen = false } = {}) {
    return this.#mutate(async () => {
      const state = await this.#read();
      const key = sessionKey(file);
      const existing = state.sessions[key] ?? {};
      const userFinished = new Set(["approved", "ended"]).has(existing.status) && existing.endedBy === "user";
      if (userFinished && !reopen) return { ...existing, reopened: false };
      const resumesFinished = new Set(["approved", "ended"]).has(existing.status);
      const session = {
        key,
        file,
        url,
        status: resumesFinished ? "open" : existing.status ?? "open",
        purpose,
        mode,
        events: resumesFinished ? [] : existing.events ?? [],
        chat: existing.chat ?? [],
        updatedAt: new Date().toISOString(),
      };
      state.sessions[key] = session;
      await this.#write(state);
      return session;
    });
  }

  async find(key) {
    await this.pendingMutation;
    const state = await this.#read();
    return state.sessions[key] ?? null;
  }

  async queueFeedback(key, payload) {
    return this.#updateSession(key, (session) => {
      const event = {
        status: "feedback",
        prompts: payload.prompts ?? [],
        domSnapshot: String(payload.domSnapshot ?? ""),
      };
      const at = new Date().toISOString();
      const userMessages = event.prompts
        .map((prompt) => {
          const submittedText = String(prompt.prompt ?? "").trim();
          const text = String(prompt.displayText ?? submittedText).trim();
          if (!submittedText || !text) return null;
          const metadata = {
            tag: String(prompt.tag ?? "message"),
            selector: String(prompt.selector ?? ""),
            text: String(prompt.text ?? ""),
          };
          if (prompt.target && typeof prompt.target === "object") metadata.target = prompt.target;
          return { role: "user", text, prompt: metadata, at };
        })
        .filter(Boolean);
      session.events = [...(session.events ?? []), event];
      session.chat = [...(session.chat ?? []), ...userMessages];
      session.status = "feedback";
    });
  }

  async queueLayoutWarnings(key, warnings) {
    return this.#updateSession(key, (session) => {
      const delivered = new Set(session.deliveredWarningKeys ?? []);
      const layoutWarnings = warnings.map((warning) => ({
        ...warning,
        persistent: delivered.has(warningKey(warning)),
      }));
      if (layoutWarnings.length === 0) return;
      session.events = [...(session.events ?? []), { status: "layout_warnings", layoutWarnings }];
      session.status = "feedback";
    });
  }

  async addAgentReply(key, text) {
    return this.#updateSession(key, (session) => {
      session.chat = [...(session.chat ?? []), { role: "agent", text, at: new Date().toISOString() }];
    });
  }

  async finish(key, { decision, endedBy }) {
    return this.#updateSession(key, (session) => {
      const status = decision === "approved" ? "approved" : "ended";
      session.events = [...(session.events ?? []), { status, endedBy }];
      session.status = status;
      session.endedBy = endedBy;
    });
  }

  async takeEvent(key) {
    return this.#mutate(async () => {
      const state = await this.#read();
      const session = state.sessions[key];
      if (!session) return { status: "missing" };
      const [event, ...remaining] = session.events ?? [];
      if (!event && new Set(["approved", "ended"]).has(session.status)) {
        return { status: session.status, endedBy: session.endedBy };
      }
      if (!event) return { status: "waiting" };
      session.events = remaining;
      recordDeliveredWarnings(session, event);
      if (remaining.length) session.status = "feedback";
      else if (!new Set(["approved", "ended"]).has(session.status)) session.status = "open";
      session.updatedAt = new Date().toISOString();
      await this.#write(state);
      return event;
    });
  }

  async #updateSession(key, update) {
    return this.#mutate(async () => {
      const state = await this.#read();
      const session = state.sessions[key];
      if (!session) return null;
      update(session);
      session.updatedAt = new Date().toISOString();
      await this.#write(state);
      return session;
    });
  }

  #mutate(operation) {
    const next = this.pendingMutation.then(operation, operation);
    this.pendingMutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async #read() {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      return { sessions: parsed.sessions ?? {} };
    } catch (error) {
      if (error?.code === "ENOENT") return { sessions: {} };
      throw error;
    }
  }

  async #write(state) {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await rename(temporary, this.file);
  }
}

function recordDeliveredWarnings(session, event) {
  if (event.status !== "layout_warnings") return;
  const delivered = new Set(session.deliveredWarningKeys ?? []);
  for (const warning of event.layoutWarnings) delivered.add(warningKey(warning));
  session.deliveredWarningKeys = [...delivered].slice(-200);
}

function warningKey(warning) {
  const magnitude = Math.floor(Number(warning.overflowPx ?? 0) / 24);
  return `${warning.kind}:${warning.selector}:${warning.axis ?? ""}:${magnitude}`;
}
