import type { ContextEvent, ExtensionAPI, ExtensionContext, ToolResultEvent, TurnEndEvent } from "@earendil-works/pi-coding-agent";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { ReviewFeedbackClient, feedbackMessage, openReceipt, originArguments,
  type FeedbackJob, type Notification, type ReviewOrigin } from "../review-feedback-client.ts";

const MESSAGE_TYPE = "review-feedback";
let launcherUsers = 0;
let priorLauncher: string | undefined;
type Pending = { id: string; notification: Notification };

function deliveryId(message: unknown): string | undefined {
  if (!message || typeof message !== "object") return;
  const value = message as { role?: string; customType?: string; details?: { delivery?: unknown } };
  if (value.role === "custom" && value.customType === MESSAGE_TYPE && typeof value.details?.delivery === "string") return value.details.delivery;
}

class FeedbackSession {
  origin?: ReviewOrigin;
  pending?: Pending;
  active?: FeedbackJob;
  stopWatching?: () => void;
  heartbeat?: ReturnType<typeof setInterval>;
  epoch = 0;
  paused = false;
  launcherAcquired = false;
  constructor(readonly pi: ExtensionAPI, readonly client: ReviewFeedbackClient) {}

  async start(ctx: ExtensionContext) {
    this.clear();
    if (!this.launcherAcquired) {
      if (launcherUsers++ === 0) priorLauncher = process.env.AI_REVIEW_AGENT_LAUNCHED;
      this.launcherAcquired = true;
    }
    process.env.AI_REVIEW_AGENT_LAUNCHED = "pi";
    const conversation = ctx.sessionManager.getSessionFile();
    if (!conversation) return;
    this.origin = { harness: "pi", conversation, workspace: ctx.cwd };
    if (!existsSync(this.client.executable)) return;
    try {
      await this.client.invoke(["abandon", ...originArguments(this.origin)], ctx.cwd);
      await this.client.invoke(["attached", ...originArguments(this.origin), "--reset-notifications"], ctx.cwd);
      this.watch(ctx);
    } catch { this.warning(ctx); }
  }

  async toolResult(event: ToolResultEvent, ctx: ExtensionContext) {
    if (event.toolName !== "bash" || !this.origin) return;
    // A later shell command can fail after open has issued a valid receipt.
    const receipt = openReceipt(event.content.filter(part => part.type === "text").map(part => part.text).join("\n"));
    if (!receipt) return;
    try {
      await this.client.attach(receipt, this.origin);
      this.paused = false;
      this.watch(ctx);
    } catch { this.warning(ctx); }
  }

  watch(ctx: ExtensionContext) {
    if (!this.origin || this.stopWatching || this.pending || this.active || this.paused) return;
    const epoch = this.epoch;
    this.stopWatching = this.client.watch(this.origin, delivery => {
      if (epoch !== this.epoch) return;
      this.stopWatching = undefined;
      if (delivery.state === "renew") { this.watch(ctx); return; }
      if (delivery.state !== "feedback") return;
      this.pending = { id: randomUUID(), notification: delivery };
      this.pi.sendMessage({ customType: MESSAGE_TYPE, content: feedbackMessage(delivery), display: true,
        details: { delivery: this.pending.id } }, { triggerTurn: true, deliverAs: "followUp" });
    }, () => {
      if (epoch !== this.epoch) return;
      this.stopWatching = undefined;
      this.warning(ctx);
    });
  }

  async context(event: ContextEvent, ctx: ExtensionContext) {
    const pending = this.pending;
    const origin = this.origin;
    if (!pending || !origin || !event.messages.some(message => deliveryId(message) === pending.id)) return;
    try {
      if (!this.active) {
        const job = await this.client.claim(pending.notification.artifact, origin);
        if (!job) return { messages: event.messages.filter(message => deliveryId(message) !== pending.id) };
        this.active = job;
        this.heartbeat = setInterval(() => {
          void this.client.renew(pending.notification.artifact, job, origin.workspace).catch(() => this.warning(ctx));
        }, 20_000);
        this.heartbeat.unref();
      }
      const content = feedbackMessage(pending.notification, this.active);
      return { messages: event.messages.map(message => deliveryId(message) === pending.id && message.role === "custom"
        ? { ...message, content } : message) };
    } catch {
      this.paused = true;
      this.warning(ctx);
      return { messages: event.messages.filter(message => deliveryId(message) !== pending.id) };
    }
  }

  async turnEnd(event: TurnEndEvent, ctx: ExtensionContext) {
    if (!this.active || !this.pending || !this.origin || event.message.role !== "assistant" || event.message.stopReason !== "stop") return;
    const job = this.active;
    const artifact = this.pending.notification.artifact;
    const text = event.message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
    this.active = undefined;
    this.pending = undefined;
    this.stopHeartbeat();
    try {
      if (!text.trim()) throw Error("No completed response");
      await this.client.finish(artifact, job, text, this.origin.workspace);
      this.watch(ctx);
    } catch {
      await this.client.fail(artifact, job, this.origin.workspace).catch(() => {});
      this.paused = true;
      this.warning(ctx);
    }
  }

  async interrupted(ctx: ExtensionContext) {
    if (this.active && this.pending && this.origin) {
      await this.client.fail(this.pending.notification.artifact, this.active, this.origin.workspace).catch(() => {});
    }
    this.active = undefined;
    this.pending = undefined;
    this.stopHeartbeat();
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.paused = true;
    this.warning(ctx);
  }

  releaseLauncher() {
    if (!this.launcherAcquired) return;
    this.launcherAcquired = false;
    if (--launcherUsers === 0 && process.env.AI_REVIEW_AGENT_LAUNCHED === "pi") {
      if (priorLauncher === undefined) delete process.env.AI_REVIEW_AGENT_LAUNCHED;
      else process.env.AI_REVIEW_AGENT_LAUNCHED = priorLauncher;
    }
  }
  stopHeartbeat() { if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = undefined; }
  warning(ctx: ExtensionContext) { ctx.ui.setStatus("review-feedback", "Review feedback needs attention; saved feedback is retained. Use /review-feedback to resume."); }
  clear() {
    this.epoch++;
    this.stopWatching?.();
    this.stopWatching = undefined;
    this.stopHeartbeat();
    this.origin = undefined;
    this.active = undefined;
    this.pending = undefined;
    this.paused = false;
  }
}

export default function reviewFeedback(pi: ExtensionAPI) {
  const session = new FeedbackSession(pi, new ReviewFeedbackClient(import.meta.url));
  pi.on("session_start", (_event, ctx) => session.start(ctx));
  pi.on("tool_result", (event, ctx) => session.toolResult(event, ctx));
  pi.on("context", (event, ctx) => session.context(event, ctx));
  pi.on("turn_end", (event, ctx) => session.turnEnd(event, ctx));
  pi.on("agent_before_settle", async (event, ctx) => {
    if (event.outcome !== "completed" && (session.active || session.pending)) await session.interrupted(ctx);
  });
  pi.on("session_shutdown", async (_event, ctx) => {
    if (session.active) await session.interrupted(ctx);
    session.clear();
    session.releaseLauncher();
  });
  pi.registerCommand("review-feedback", { description: "Resume saved feedback for this originating conversation",
    handler: async (_arguments, ctx) => { await ctx.waitForIdle(); ctx.ui.setStatus("review-feedback", undefined); await session.start(ctx); } });
}
