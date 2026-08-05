import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { SessionStore } from "../../skills/review-artifact/runtime/session-store.mjs";

describe("review session store", () => {
  test("delivers a queued feedback batch exactly once", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-store-"));
    const store = new SessionStore(path.join(directory, "state.json"));
    const session = await store.upsert("/project/specs.html", "http://127.0.0.1/session/key");

    await store.queueFeedback(session.key, {
      prompts: [{ prompt: "Clarify this", selector: "main > section", tag: "section", text: "Scope" }],
      domSnapshot: "main\n  section Scope",
    });

    expect(await store.takeEvent(session.key)).toMatchObject({
      status: "feedback",
      prompts: [{ prompt: "Clarify this", selector: "main > section" }],
      domSnapshot: "main\n  section Scope",
    });
    expect(await store.takeEvent(session.key)).toEqual({ status: "waiting" });
  });

  test("keeps submitted user feedback in the conversation history", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-store-"));
    const store = new SessionStore(path.join(directory, "state.json"));
    const session = await store.upsert("/project/specs.html", "http://127.0.0.1/session/spec");

    await store.queueFeedback(session.key, {
      prompts: [
        { prompt: "Clarify this", selector: "main" },
        { prompt: "I prefer the first option", tag: "message" },
      ],
    });

    expect((await store.find(session.key)).chat).toMatchObject([
      {
        role: "user",
        text: "Clarify this",
        prompt: { tag: "message", selector: "main", text: "" },
      },
      {
        role: "user",
        text: "I prefer the first option",
        prompt: { tag: "message", selector: "", text: "" },
      },
    ]);
  });

  test("keeps a form payload in feedback while showing only its plain summary", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-store-"));
    const store = new SessionStore(path.join(directory, "state.json"));
    const session = await store.upsert("/project/review.html", "http://127.0.0.1/session/review");
    const payload = '{"action":"fix-selected","selectedFindingIds":["review-1"]}';

    await store.queueFeedback(session.key, {
      prompts: [{ prompt: payload, displayText: "Review decisions", tag: "review-decisions" }],
    });

    expect(await store.takeEvent(session.key)).toMatchObject({
      prompts: [{ prompt: payload, displayText: "Review decisions" }],
    });
    expect((await store.find(session.key)).chat).toMatchObject([{
      role: "user",
      text: "Review decisions",
      prompt: { tag: "review-decisions" },
    }]);
  });

  test("keeps element and text-range targets in the conversation history", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-store-"));
    const store = new SessionStore(path.join(directory, "state.json"));
    const session = await store.upsert("/project/specs.html", "http://127.0.0.1/session/spec");

    await store.queueFeedback(session.key, {
      prompts: [{
        prompt: "Reword this",
        selector: "main > p",
        tag: "text",
        text: "Current wording",
        target: { type: "text-range", selector: "main > p", text: "Current wording" },
      }],
    });

    expect((await store.find(session.key)).chat).toMatchObject([{
      role: "user",
      text: "Reword this",
      prompt: {
        tag: "text",
        selector: "main > p",
        text: "Current wording",
        target: { type: "text-range", selector: "main > p", text: "Current wording" },
      },
    }]);
  });

  test("preserves concurrent feedback batches", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-store-"));
    const store = new SessionStore(path.join(directory, "state.json"));
    const session = await store.upsert("/project/specs.html", "http://127.0.0.1/session/spec");

    await Promise.all([
      store.queueFeedback(session.key, { prompts: [{ prompt: "First" }] }),
      store.queueFeedback(session.key, { prompts: [{ prompt: "Second" }] }),
    ]);
    const events = [await store.takeEvent(session.key), await store.takeEvent(session.key)];

    expect(events.map((event) => event.prompts[0].prompt).sort()).toEqual(["First", "Second"]);
  });

  test("delivers explicit approval separately from an unapproved end", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-store-"));
    const store = new SessionStore(path.join(directory, "state.json"));
    const approved = await store.upsert("/project/specs.html", "http://127.0.0.1/session/spec");
    const ended = await store.upsert("/project/tasks.html", "http://127.0.0.1/session/tasks");

    await store.finish(approved.key, { decision: "approved", endedBy: "user" });
    await store.finish(ended.key, { decision: "ended", endedBy: "user" });

    expect(await store.takeEvent(approved.key)).toEqual({ status: "approved", endedBy: "user" });
    expect(await store.takeEvent(ended.key)).toEqual({ status: "ended", endedBy: "user" });
  });
});
