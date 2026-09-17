import { describe, expect, test } from "bun:test";

import { verifyInlineLocations } from "../../skills/review-change/runtime/review-publication-inline-locations.mjs";
import { createGitHubProvider } from "../../skills/review-change/runtime/review-publication-provider.mjs";
import { currentPullRequest, publicationClaims } from "./review-publication-fixtures";

describe("Review publication inline-location evidence", () => {
  test("uses a complete diff fallback for omitted and truncated file patches", async () => {
    const claims = publicationClaims();
    const fixtures = [
      { name: "omitted patch", file: { filename: claims.findings[0].path } },
      { name: "truncated patch", file: { filename: claims.findings[0].path, patch: "@@ -1,1 +1,1 @@\n-old\n+new" } },
    ];
    for (const fixture of fixtures) {
      let fallbackReads = 0;
      const provider = createGitHubProvider({
        execute: async (args: string[]) => {
          if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
          if (args[0] === "repo") return JSON.stringify(claims.repository);
          if (args[0] === "pr") return pullRequestScopeResponse(claims);
          if (String(args.at(-1)).includes("/files?")) return JSON.stringify([[fixture.file]]);
          if (args.includes("Accept: application/vnd.github.diff")) {
            fallbackReads += 1;
            return pullRequestDiff(claims.findings[0].path, claims.findings[0].line);
          }
          throw new Error(`Unexpected GitHub read: ${args.join(" ")}`);
        },
      });

      expect({ name: fixture.name, current: await provider.inspectPullRequest(claims), fallbackReads }).toEqual({
        name: fixture.name,
        current: currentPullRequest(claims),
        fallbackReads: 1,
      });
    }
  });

  test("decodes Git-quoted omitted and truncated paths for both diff coordinates", async () => {
    const oldPath = "src/old \"quote\" \\ tab\tline\ncafé.ts";
    const newPath = "src/new \"quote\" \\ tab\tline\ncafé.ts";
    const findings = [
      { id: "RPC-090-L", title: "Left coordinate", path: oldPath, line: 41, side: "LEFT" },
      { id: "RPC-090-R", title: "Right coordinate", path: newPath, line: 84, side: "RIGHT" },
    ];
    const completeDiff = quotedRenameDiff(oldPath, newPath, 41, 84);
    const files = [
      { name: "omitted patch", entries: [{ filename: newPath }] },
      { name: "truncated patch", entries: [{ filename: newPath, patch: "@@ -1,1 +1,1 @@\n-old\n+new" }] },
    ];

    for (const fixture of files) {
      await expect(verifyInlineLocations(findings, fixture.entries, async () => completeDiff)).resolves.toBeUndefined();
    }
  });

  test("rejects malformed or ambiguous Git-quoted complete-diff headers", async () => {
    const path = "src/café.ts";
    const finding = { id: "RPC-090", title: "Malformed path", path, line: 8, side: "RIGHT" };
    const malformedDiffs = [
      pullRequestDiff(path, 8).replace(`b/${path}`, `"b/src/invalid\\q.ts"`),
      pullRequestDiff(path, 8).replace(`b/${path}`, `"b/src/invalid\\777.ts"`),
      pullRequestDiff(path, 8).replace(`b/${path}`, `"b/src/invalid\\303x.ts"`),
      pullRequestDiff(path, 8).replace(` b/${path}`, ` b/${path} trailing`),
      pullRequestDiff(path, 8).replace(`+++ b/${path}`, "+++ b/src/other.ts"),
    ];

    for (const completeDiff of malformedDiffs) {
      await expect(verifyInlineLocations([finding], [], async () => completeDiff)).rejects.toMatchObject({
        code: "inline_location_unverifiable",
        status: 502,
      });
    }
  });

  test("returns invalid inline location only when the complete diff proves absence", async () => {
    const claims = publicationClaims();
    const provider = providerWithDiffFallback(claims, pullRequestDiff(claims.findings[0].path, 12));

    await expect(provider.inspectPullRequest(claims)).rejects.toMatchObject({
      code: "invalid_inline_location",
      status: 409,
    });
  });

  test("returns a typed unverifiable location without mutation when the complete diff fallback fails", async () => {
    const claims = publicationClaims();
    let mutations = 0;
    const provider = providerWithDiffFallback(claims, Object.assign(new Error("fallback unavailable"), {
      code: "provider_timeout",
      status: 504,
    }), () => { mutations += 1; });

    await expect(provider.inspectPullRequest(claims)).rejects.toMatchObject({
      code: "inline_location_unverifiable",
      status: 502,
      details: { findingId: claims.findings[0].id },
    });
    expect(mutations).toBe(0);
  });
});

function providerWithDiffFallback(
  claims: ReturnType<typeof publicationClaims>,
  fallback: string | Error,
  onMutation: () => void = () => {},
) {
  return createGitHubProvider({
    execute: async (args: string[]) => {
      if (args.join(" ") === "api user") return JSON.stringify({ node_id: claims.actor.id, login: claims.actor.login });
      if (args[0] === "repo") return JSON.stringify(claims.repository);
      if (args[0] === "pr") return pullRequestScopeResponse(claims);
      if (String(args.at(-1)).includes("/files?")) {
        return JSON.stringify([[{ filename: claims.findings[0].path }]]);
      }
      if (args.includes("Accept: application/vnd.github.diff")) {
        if (fallback instanceof Error) throw fallback;
        return fallback;
      }
      if (args.includes("POST")) onMutation();
      throw new Error(`Unexpected GitHub request: ${args.join(" ")}`);
    },
  });
}

function pullRequestScopeResponse(claims: ReturnType<typeof publicationClaims>) {
  return JSON.stringify({
    id: claims.pullRequest.id,
    number: claims.pullRequest.number,
    state: "OPEN",
    baseRefOid: claims.scope.baseOid,
    headRefOid: claims.scope.headOid,
  });
}

function quotedRenameDiff(oldPath: string, newPath: string, oldLine: number, newLine: number) {
  return [
    `diff --git ${quoteGitPath(`a/${oldPath}`, true)} ${quoteGitPath(`b/${newPath}`, false)}`,
    "similarity index 90%",
    `rename from ${oldPath}`,
    `rename to ${newPath}`,
    `--- ${quoteGitPath(`a/${oldPath}`, true)}`,
    `+++ ${quoteGitPath(`b/${newPath}`, false)}`,
    `@@ -${oldLine},1 +${newLine},1 @@`,
    "-old",
    "+new",
    "",
  ].join("\n");
}

function quoteGitPath(filePath: string, octalUtf8: boolean) {
  let quoted = "\"";
  for (const character of filePath) {
    if (character === "\"") quoted += "\\\"";
    else if (character === "\\") quoted += "\\\\";
    else if (character === "\t") quoted += "\\t";
    else if (character === "\n") quoted += "\\n";
    else if (octalUtf8 && character.codePointAt(0)! > 0x7f) {
      quoted += [...Buffer.from(character)].map((byte) => `\\${byte.toString(8).padStart(3, "0")}`).join("");
    } else quoted += character;
  }
  return `${quoted}\"`;
}

function pullRequestDiff(filePath: string, line: number) {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    "index 1111111..2222222 100644",
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${line},1 +${line},1 @@`,
    "-old",
    "+new",
    "",
  ].join("\n");
}
