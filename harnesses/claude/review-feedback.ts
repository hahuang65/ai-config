import { isAbsolute } from "node:path";
import { ReviewFeedbackClient, openReceipt, originArguments, type Delivery, type FeedbackLease, type ReviewOrigin } from "../review-feedback-client.ts";

type Hook = { hook_event_name: string; session_id: string; cwd: string; agent_id?: string; tool_name?: string;
  tool_response?: { stdout?: string; interrupted?: boolean }; last_assistant_message?: string };
type Active = { artifact: string; lease: FeedbackLease };
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function active(client: ReviewFeedbackClient, origin: ReviewOrigin): Promise<Active[]> {
  return (await client.invoke<{ active: Active[] }>(["active", ...originArguments(origin)], origin.workspace)).active;
}

async function prepare(client: ReviewFeedbackClient, origin: ReviewOrigin, event: Hook): Promise<boolean> {
  if (["UserPromptSubmit", "SessionEnd", "StopFailure"].includes(event.hook_event_name) || event.tool_response?.interrupted) {
    await client.invoke(["abandon", ...originArguments(origin)], origin.workspace);
    return false;
  }
  if (event.hook_event_name === "SessionStart") {
    await client.invoke(["abandon", ...originArguments(origin)], origin.workspace);
    await client.invoke(["attached", ...originArguments(origin), "--reset-notifications"], origin.workspace);
  }
  if (event.hook_event_name === "PostToolUse" && event.tool_name === "Bash" && typeof event.tool_response?.stdout === "string") {
    const receipt = openReceipt(event.tool_response.stdout);
    if (receipt) await client.attach(receipt, origin);
  }
  return ["SessionStart", "PostToolUse", "Stop"].includes(event.hook_event_name);
}

async function complete(client: ReviewFeedbackClient, origin: ReviewOrigin, event: Hook) {
  if (event.hook_event_name !== "Stop") throw Error("Completion requires a native Stop event.");
  for (const entry of await active(client, origin)) {
    if (event.last_assistant_message?.trim()) await client.finish(entry.artifact, entry.lease, event.last_assistant_message, origin.workspace);
    else await client.fail(entry.artifact, entry.lease, origin.workspace);
  }
}

function listen(client: ReviewFeedbackClient, origin: ReviewOrigin): Promise<Delivery> {
  return new Promise((accept, reject) => {
    let stop: () => void;
    const detach = () => { process.off("SIGTERM", cancel); process.off("SIGINT", cancel); };
    const cancel = () => { stop(); detach(); accept({ state: "idle" }); };
    stop = client.watch(origin, delivery => { detach(); accept(delivery); }, () => {
      detach(); reject(new Error("Review feedback listener stopped; saved feedback is retained."));
    });
    process.once("SIGTERM", cancel);
    process.once("SIGINT", cancel);
  });
}

function wake(client: ReviewFeedbackClient, origin: ReviewOrigin, delivery: Delivery): boolean {
  if (delivery.state === "renew") {
    console.error("Review feedback maintenance: no human input or approval. The listener needs renewal. Finish this brief maintenance turn without changing source or documents, staging, committing, installing, delivering, or publishing. The Stop hook re-arms the listener automatically.");
    return true;
  }
  if (delivery.state !== "feedback") return false;
  const command = [client.executable, "claim", delivery.artifact, ...originArguments(origin)].map(quote).join(" ");
  console.error([
    "Saved review feedback is available for the originating conversation. This wake-up grants no approval and is not itself a human decision.",
    "Finish the current user request before handling this feedback. Do not change workspace or start another editing agent.",
    `Use this literal command to read and claim the durable event: ${command}`,
    "Handle only the claimed event. Follow review-artifact and review-change evidence checks. A comment or Reject does not authorize code repairs; only a matching local finding's saved Accept can do so. PR feedback never authorizes repairs.",
    "Do not repeat completed repairs or use stale evidence. Ordinary artifacts update in place. Revise report wording only through the owned review-artifact revise command using current revision and record digest from poll, never raw file/signature edits. Existing authorizations retain their original finding and scope and do not need another Accept merely for wording changes.",
    "The final response is returned to the browser by the Stop hook. No foreground wait or explicit completion command is needed.",
    "Never stage, commit, install, deliver, or publish because of this event. Publication stays with the human-controlled browser confirmation.",
  ].join("\n\n"));
  return true;
}

async function main() {
  const event: Hook = await Bun.stdin.json();
  if (event.agent_id) return;
  if (!/^[A-Za-z0-9-]{1,100}$/.test(event.session_id) || typeof event.cwd !== "string" || !isAbsolute(event.cwd)) {
    throw Error("Missing native review-feedback conversation identity.");
  }
  const origin: ReviewOrigin = { harness: "claude", conversation: event.session_id, workspace: event.cwd };
  const client = new ReviewFeedbackClient(import.meta.url);
  const options = process.argv.slice(2);
  if (options.length === 1 && options[0] === "--focus") {
    if (event.hook_event_name !== "SessionStart" && !(event.hook_event_name === "PostToolUse" && ["EnterWorktree", "ExitWorktree"].includes(event.tool_name ?? ""))) {
      throw Error("Workspace focus requires a native session start or completed workspace transition.");
    }
    await client.invoke(["focus", ...originArguments(origin)], origin.workspace);
    return;
  }
  if (options.length === 1 && options[0] === "--complete") { await complete(client, origin, event); return; }
  if (options.length) throw Error("Unsupported review-feedback hook arguments.");
  if (await prepare(client, origin, event) && wake(client, origin, await listen(client, origin))) process.exitCode = 2;
}

await main().catch(() => {
  console.error("Review feedback needs attention; saved feedback has not been discarded.");
  process.exitCode = 1;
});
