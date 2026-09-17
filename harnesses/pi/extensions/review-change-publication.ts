import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
  prepareFrozenPublicationScope,
  renderPreparedPublication,
} from "../../../skills/review-change/runtime/review-publication-boundary.mjs";
import { renderPublicationFragment } from "../../../skills/review-change/runtime/review-publication-html.mjs";
import { normalizePublicationFindings } from "../../../skills/review-change/runtime/review-publication-protocol.mjs";
import {
  isReviewChangeInvocation,
  requestedPullRequestTarget,
} from "../../../skills/review-change/runtime/review-publication-invocation.mjs";
import {
  createGitHubProvider,
  resolveGitHubCliPath,
} from "../../../skills/review-change/runtime/review-publication-provider.mjs";

interface PublicationFinding {
  id: string;
  title: string;
  body: string;
  path: string;
  line: number;
  side: "LEFT" | "RIGHT";
}

interface PreparedPublication {
  host: string;
  signingKeyId: string;
  commentTemplateVersion: number;
  repository: { id: string; nameWithOwner: string };
  pullRequest: { id: string; number: number; url: string };
  scope: { baseOid: string; headOid: string };
  frozenScope: string;
}

interface PublicationProvider {
  getActor: (...arguments_: any[]) => Promise<any>;
  preparePullRequest: (...arguments_: any[]) => Promise<any>;
}

interface PublicationDependencies {
  environment?: Record<string, string | undefined>;
  keyLoader?: (...arguments_: any[]) => Promise<Buffer>;
  prepare?: (request: { target: string; cwd: string }) => Promise<PreparedPublication>;
  render?: (request: {
    prepared: PreparedPublication;
    findings: PublicationFinding[];
  }) => Promise<{ fragmentPath?: string; fragment: string }>;
}

interface InputEvent {
  text?: string;
  source?: string;
}

const PUBLICATION_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action"],
  properties: {
    action: { type: "string", enum: ["scope", "render"] },
    findings: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "body", "path", "line", "side"],
        properties: {
          id: { type: "string", minLength: 1, maxLength: 64 },
          title: { type: "string", minLength: 1, maxLength: 500 },
          body: { type: "string", minLength: 1, maxLength: 10_000 },
          path: { type: "string", minLength: 1, maxLength: 1024 },
          line: { type: "integer", minimum: 1 },
          side: { type: "string", enum: ["LEFT", "RIGHT"] },
        },
      },
    },
  },
} as const;

export function registerReviewChangePublication(
  pi: Pick<ExtensionAPI, "on" | "registerTool">,
  dependencies: PublicationDependencies = {},
): boolean {
  const environment = dependencies.environment ?? process.env;
  if (environment.REVIEW_CHANGE_GATE === "1") return false;
  let generation = 0;
  let prepared: PreparedPublication | undefined;
  let preparedProvider: PublicationProvider | undefined;
  let preparationFailure: Error | undefined;

  const resetPrepared = () => {
    generation += 1;
    prepared = undefined;
    preparedProvider = undefined;
    preparationFailure = undefined;
  };

  pi.on("session_start", resetPrepared);
  pi.on("input", async (event, context) => {
    const input = event as InputEvent;
    if (input.source === "extension") return;
    const text = input.text ?? "";
    const target = requestedPullRequestTarget(text);
    if (!target && !isReviewChangeInvocation(text)) return;
    resetPrepared();
    const currentGeneration = generation;
    if (!target) return;
    try {
      const provider = defaultProvider(dependencies);
      const frozen = dependencies.prepare
        ? await dependencies.prepare({ target, cwd: context.cwd })
        : await defaultPrepare({ target }, provider, dependencies.keyLoader);
      if (generation === currentGeneration) {
        prepared = frozen;
        preparedProvider = provider;
      }
    } catch (error) {
      if (generation === currentGeneration) preparationFailure = asError(error);
    }
  });
  pi.on("session_shutdown", resetPrepared);

  pi.registerTool({
    name: "review_change_publication",
    label: "Review Change Publication",
    description: "Read the pull-request scope frozen from the current user invocation or render its signed Review publication form. The tool accepts Finding claims but never accepts a repository, pull request, base, or head.",
    promptSnippet: "Use the trusted frozen scope and renderer for an in-session pull-request Review change report",
    promptGuidelines: [
      "For a direct in-session Review change, call review_change_publication with action scope before authoring publication claims; use action render only with the final Finding claims, and embed the returned fragment unchanged.",
      "If review_change_publication reports no capability, keep the Review change report presentation-only.",
    ],
    parameters: PUBLICATION_TOOL_SCHEMA as never,
    async execute(_toolCallId, params) {
      assertToolArguments(params as Record<string, unknown>);
      if (preparationFailure) throw new Error(`Review publication could not freeze the requested pull request: ${preparationFailure.message}`);
      if (!prepared) throw new Error("Review publication is not available for this review target");
      if (params.action === "scope") {
        const identity = publicIdentity(prepared);
        return {
          content: [{ type: "text", text: JSON.stringify(identity) }],
          details: identity,
        };
      }
      const rendered = dependencies.render
        ? await dependencies.render({
          prepared,
          findings: params.findings as PublicationFinding[],
        })
        : await defaultRender({
          prepared,
          findings: params.findings as PublicationFinding[],
        }, requiredProvider(preparedProvider), dependencies.keyLoader);
      return {
        content: [{ type: "text", text: rendered.fragment }],
        details: rendered.fragmentPath ? { fragmentPath: rendered.fragmentPath } : {},
      };
    },
  } as never);
  return true;
}

export { requestedPullRequestTarget };

function defaultProvider(dependencies: PublicationDependencies): PublicationProvider | undefined {
  if (dependencies.prepare && dependencies.render) return undefined;
  const environment = dependencies.environment ?? process.env;
  const ghPath = resolveGitHubCliPath({ environment });
  return createGitHubProvider({ ghPath, environment });
}

async function defaultPrepare(
  { target }: { target: string },
  provider: PublicationProvider | undefined,
  keyLoader?: (...arguments_: any[]) => Promise<Buffer>,
): Promise<PreparedPublication> {
  return prepareFrozenPublicationScope(target, {
    provider: requiredProvider(provider),
    ...(keyLoader ? { keyLoader } : {}),
  });
}

async function defaultRender({ prepared, findings }: {
  prepared: PreparedPublication;
  findings: PublicationFinding[];
}, provider: PublicationProvider, keyLoader?: (...arguments_: any[]) => Promise<Buffer>): Promise<{ fragment: string }> {
  const rendered = await renderPreparedPublication(prepared, findings, {
    provider,
    ...(keyLoader ? { keyLoader } : {}),
  });
  return {
    fragment: renderPublicationFragment({
      publicationToken: rendered.publicationToken,
      findings,
      review: rendered.review,
    }),
  };
}

function requiredProvider(provider: PublicationProvider | undefined): PublicationProvider {
  if (!provider) throw new Error("Review publication provider is unavailable");
  return provider;
}

function assertToolArguments(params: Record<string, unknown>): void {
  const action = params.action;
  const allowed = action === "scope" ? new Set(["action"]) : new Set(["action", "findings"]);
  if (!["scope", "render"].includes(String(action)) || Object.keys(params).some((key) => !allowed.has(key))) {
    throw new Error("Review publication only accepts Finding claims; its frozen target cannot be replaced");
  }
  if (action === "scope" && params.findings !== undefined) {
    throw new Error("Review publication scope does not accept Finding claims");
  }
  if (action === "render") {
    try {
      params.findings = normalizePublicationFindings(params.findings);
    } catch {
      throw new Error("Review publication requires every inline Finding to include an explicit LEFT or RIGHT diff side");
    }
  }
}

function publicIdentity(prepared: PreparedPublication) {
  return {
    host: prepared.host,
    signingKeyId: prepared.signingKeyId,
    commentTemplateVersion: prepared.commentTemplateVersion,
    repository: prepared.repository,
    pullRequest: prepared.pullRequest,
    scope: prepared.scope,
  };
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

export default function reviewChangePublication(pi: ExtensionAPI) {
  registerReviewChangePublication(pi);
}
