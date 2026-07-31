import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const STAGES = ["review", "evidence", "documentation", "lint", "report"] as const;
const ACTIONS = ["start", "step", "log", "complete", "fail", "wait"] as const;
const PROGRESS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stage", "action", "message"],
  properties: {
    stage: { type: "string", enum: [...STAGES] },
    action: { type: "string", enum: [...ACTIONS] },
    message: { type: "string", minLength: 1, maxLength: 500 },
    findings: { type: "integer", minimum: 0 },
    risk: { type: "string", enum: ["low", "medium", "high"] },
  },
} as const;

export function registerChangeReviewProgress(
  pi: Pick<ExtensionAPI, "registerTool">,
  environment: Record<string, string | undefined> = process.env,
): boolean {
  if (environment.CHANGE_REVIEW_GATE !== "1") return false;

  pi.registerTool({
    name: "change_review_status",
    label: "Change Review Status",
    description: "Report the active standalone Change review stage and a concise factual activity or outcome to the parent full-screen TUI.",
    promptSnippet: "Report standalone Change review stage transitions and factual activity",
    promptGuidelines: [
      "Use change_review_status alone before and after every review, evidence, documentation, lint, and report stage in standalone Change review; wait for its successful result before issuing stage work, announce each current sub-stage with a step message of no more than six words before performing it, use one log call of no more than six words per observable Finding, missing-evidence item, documentation issue, or other collected item without repeating its parent labels, never combine or summarize collected items in the completion message, and complete the report without waiting for approval.",
    ],
    parameters: PROGRESS_SCHEMA as never,
    async execute(_toolCallId, params) {
      const details: Record<string, unknown> = { stage: params.stage, action: params.action };
      if (Number.isInteger(params.findings)) details.findings = params.findings;
      if (params.risk) details.risk = params.risk;
      return {
        content: [{ type: "text", text: `Recorded ${params.stage} ${params.action} status.` }],
        details,
      };
    },
  });
  return true;
}

export default function changeReviewProgress(pi: ExtensionAPI) {
  registerChangeReviewProgress(pi);
}
