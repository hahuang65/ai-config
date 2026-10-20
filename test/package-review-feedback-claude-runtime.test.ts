import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { startFakeClaudeApi } from "./fixtures/claude-api";
import { feedbackScenario, renewalScenario, startFeedbackClaude, until } from "./fixtures/review-feedback-claude";

const claude = Bun.which("claude");
const nativeTest = process.platform === "darwin" && claude && existsSync("/usr/bin/sandbox-exec") ? test : test.skip;

nativeTest("Claude renews its idle feedback hook twice and still receives later feedback", async () => {
  const scenario = renewalScenario();
  const api = startFakeClaudeApi([], "FIXTURE_COMPLETE", { additionalTurns: 3 });
  const run = startFeedbackClaude(scenario, api.server.port);
  try {
    run.send("FINISH_INITIAL_SYNTHETIC_TASK");
    await until(() => existsSync(scenario.counter) && Number(readFileSync(scenario.counter, "utf8")) >= 3, run.output);
    expect(api.requests).toHaveLength(3);
    expect(JSON.stringify(api.requests[1])).toContain("REVIEW_FEEDBACK_RENEW");
    expect(JSON.stringify(api.requests[2])).toContain("REVIEW_FEEDBACK_RENEW");
    expect(JSON.stringify(api.requests)).not.toContain("REVIEW_FEEDBACK_AFTER_RENEWAL");
    writeFileSync(scenario.marker, "Synthetic human feedback after two idle renewals.");
    await until(() => api.requests.length === 4, run.output);
    expect(JSON.stringify(api.requests[3])).toContain("REVIEW_FEEDBACK_AFTER_RENEWAL");
  } finally {
    await run.stop();
    api.server.stop(true);
  }
}, 50_000);

nativeTest("Claude asyncRewake delivers feedback after a completed turn without another user prompt", async () => {
  const scenario = feedbackScenario();
  const api = startFakeClaudeApi([{ name: "Read", input: { file_path: scenario.artifact } }]);
  const run = startFeedbackClaude(scenario, api.server.port);
  try {
    run.send("READ_DISPOSABLE_REVIEW");
    await until(() => run.output().includes('"type":"result"'), run.output);
    expect(api.requests).toHaveLength(2);
    writeFileSync(scenario.marker, "Human feedback arrived after the originating turn finished.");
    await until(() => api.requests.length === 3, run.output);
    expect(JSON.stringify(api.requests[2])).toContain("REVIEW_FEEDBACK_NATIVE_WAKE");
  } finally {
    await run.stop();
    api.server.stop(true);
  }
}, 50_000);

nativeTest("Claude cancels an idle wake-up hook at its native timeout", async () => {
  const scenario = feedbackScenario(1);
  const api = startFakeClaudeApi([{ name: "Read", input: { file_path: scenario.artifact } }]);
  const run = startFeedbackClaude(scenario, api.server.port);
  try {
    run.send("READ_DISPOSABLE_REVIEW");
    await until(() => run.output().includes('\"type\":\"result\"'), run.output);
    await until(() => existsSync(`${scenario.marker}.cancelled`), run.output);
    expect(api.requests).toHaveLength(2);
    writeFileSync(scenario.marker, "Feedback arrived after the native listener timeout.");
    run.send("A_GENUINE_NEXT_USER_PROMPT");
    await until(() => api.requests.length === 3, run.output);
    expect(JSON.stringify(api.requests[2])).not.toContain("REVIEW_FEEDBACK_NATIVE_WAKE");
  } finally {
    await run.stop();
    api.server.stop(true);
  }
}, 50_000);

nativeTest("Claude asyncRewake queues behind a busy model response instead of interrupting it", async () => {
  const scenario = feedbackScenario();
  const gate = Promise.withResolvers<void>();
  let released = false;
  let arrivedBeforeRelease = false;
  const api = startFakeClaudeApi([{ name: "Read", input: { file_path: scenario.artifact } }], "FIXTURE_COMPLETE", {
    additionalTurns: 2, async onRequest(_request, count) {
      if (count === 3) await gate.promise;
      if (count === 4) arrivedBeforeRelease = !released;
    },
  });
  const run = startFeedbackClaude(scenario, api.server.port);
  try {
    run.send("READ_DISPOSABLE_REVIEW");
    await until(() => run.output().includes('"type":"result"'), run.output);
    run.send("FINISH_UNRELATED_WORK_FIRST");
    await until(() => api.requests.length === 3, run.output);
    writeFileSync(scenario.marker, "Human feedback arrived while the model was busy.");
    await until(() => existsSync(`${scenario.marker}.sent`), run.output);
    released = true;
    gate.resolve();
    await until(() => api.requests.length === 4, run.output);
    expect(arrivedBeforeRelease).toBe(false);
    expect(JSON.stringify(api.requests[2])).not.toContain("REVIEW_FEEDBACK_NATIVE_WAKE");
    expect(JSON.stringify(api.requests[3])).toContain("REVIEW_FEEDBACK_NATIVE_WAKE");
    const previousAnswers = api.requests[3].messages?.filter(message =>
      "role" in message && message.role === "assistant" && JSON.stringify(message.content).includes("FIXTURE_COMPLETE"));
    expect(previousAnswers, JSON.stringify(api.requests[3].messages, null, 2)).toHaveLength(2);
  } finally {
    gate.resolve();
    await run.stop();
    api.server.stop(true);
  }
}, 50_000);
