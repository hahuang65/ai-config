import { afterEach, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { startReviewServer } from "../../skills/review-artifact/runtime/server.mjs";

const executable = path.resolve(import.meta.dir, "../../skills/review-artifact/bin/review-artifact.mjs");
const servers: Array<{ close(): Promise<void> }> = [];
const temporaryDirectories: string[] = [];

async function runReviewArtifact(
  args: string[],
  stateDirectory: string,
  environment: Record<string, string> = {},
) {
  const child = Bun.spawn(["node", executable, ...args], {
    env: { ...process.env, REVIEW_ARTIFACT_STATE_DIR: stateDirectory, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr, serverStarted: existsSync(stateDirectory) };
}

async function createProcessFixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-process-"));
  temporaryDirectories.push(directory);
  const stateDirectory = path.join(directory, "state");
  const artifact = path.join(directory, "specs.html");
  const agentToken = "process-cli-agent-token";
  await mkdir(stateDirectory);
  await writeFile(artifact, "<!doctype html><title>Spec</title>");
  const server = await startReviewServer({
    port: 0,
    stateFile: path.join(stateDirectory, "state.json"),
    agentToken,
  });
  servers.push(server);
  await writeFile(path.join(stateDirectory, "server.json"), JSON.stringify({ agentToken }));
  return {
    artifact,
    canonicalArtifact: await realpath(artifact),
    server,
    stateDirectory,
    environment: { REVIEW_ARTIFACT_PORT: new URL(server.baseUrl).port },
  };
}

async function openFixture(fixture: Awaited<ReturnType<typeof createProcessFixture>>) {
  const output = await runReviewArtifact(
    ["open", fixture.artifact, "--no-open"],
    fixture.stateDirectory,
    fixture.environment,
  );
  return JSON.parse(output.stdout);
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
  })));
});

describe("review artifact executable argument boundary", () => {
  test("rejects help after the private server invocation before server startup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-server-help-"));
    temporaryDirectories.push(directory);
    const stateDirectory = path.join(directory, "state");

    expect(await runReviewArtifact(["server", "--help"], stateDirectory, {
      REVIEW_ARTIFACT_PORT: "0",
    })).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: server accepts no arguments\nRun review-artifact --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects a trailing positional after the private server invocation before server startup", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-server-argument-"));
    temporaryDirectories.push(directory);
    const stateDirectory = path.join(directory, "state");

    expect(await runReviewArtifact(["server", "unexpected"], stateDirectory, {
      REVIEW_ARTIFACT_PORT: "0",
    })).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: server accepts no arguments\nRun review-artifact --help for usage.\n",
      serverStarted: false,
    });
  });

  test("bounds and redacts rejected command and option tokens", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-rejected-preview-"));
    temporaryDirectories.push(directory);
    const stateDirectory = path.join(directory, "state");

    const oversized = await runReviewArtifact([
      "open",
      "specs.html",
      `--${"x".repeat(4_000)}`,
    ], stateDirectory);
    const credentialLike = await runReviewArtifact([
      "token=do-not-disclose-this-value",
    ], stateDirectory);
    const whitespaceFlag = await runReviewArtifact([
      "--token whitespace-separated-secret",
    ], stateDirectory);
    const quotedAssignment = await runReviewArtifact([
      "password:\"quoted secret with spaces\"",
    ], stateDirectory);
    const affixedCredentials = await runReviewArtifact([
      "GITHUB_TOKEN=p@ss/word:.+!?[]{}() continue",
    ], stateDirectory);
    const affixedFlag = await runReviewArtifact([
      "--db-password \"quoted secret with spaces\" --dry-run",
    ], stateDirectory);
    const punctuationAssignment = await runReviewArtifact([
      "DB_PASSWORD=db,value;with-punctuation migrate",
    ], stateDirectory);
    const prefixedAssignments = await runReviewArtifact([
      "PROD_API_KEY='prod key with spaces' CLIENT_SECRET=\"client secret with spaces\" continue",
    ], stateDirectory);
    const followingOption = await runReviewArtifact([
      "--token --dry-run",
    ], stateDirectory);
    const metric = await runReviewArtifact([
      "token_count=42 metrics",
    ], stateDirectory);
    const credentialUri = await runReviewArtifact([
      "postgresql://alice:uri-secret@example.com/database",
    ], stateDirectory);
    const authorization = await runReviewArtifact([
      "Authorization: Digest username=\"fixture-user\", nonce=\"fixture-nonce\", response=\"fixture-response\"\nnext-command --dry-run",
    ], stateDirectory);
    const basicAuthorization = await runReviewArtifact([
      `curl -H "Authorization: Basic fixture-basic==" https://example.test/basic; printf kept`,
    ], stateDirectory);
    const bearerAuthorization = await runReviewArtifact([
      `curl -H 'Authorization: Bearer fixture-bearer' https://example.test/bearer; printf kept`,
    ], stateDirectory);
    const quotedAuthorization = await runReviewArtifact([
      `curl -H "Authorization: Custom fixture-custom" https://example.test/header; printf kept`,
    ], stateDirectory);
    const objectAuthorization = await runReviewArtifact([
      `{"Authorization":"Token fixture-token","url":"https://example.test/object"}`,
    ], stateDirectory);
    const objectCredentials = await runReviewArtifact([
      `{"access_token":"fixture-access-value","client_secret":"fixture-client-value","status":"kept"}`,
    ], stateDirectory);
    const compoundKeys = await runReviewArtifact([
      `${["AWS", "SECRET", "ACCESS", "KEY"].join("_")}=fixture-aws-value SSH_PRIVATE_KEY='fixture private key' private_key_count=7`,
    ], stateDirectory);
    const knownTokenValue = `gh${"p"}_${"fixtureKnownToken123"}`;
    const knownToken = await runReviewArtifact([knownTokenValue], stateDirectory);

    expect(oversized.exitCode).toBe(2);
    expect(oversized.stdout).toBe("");
    expect(oversized.stderr).toContain("characters omitted");
    expect(oversized.stderr.length).toBeLessThan(400);
    expect(oversized.serverStarted).toBe(false);
    expect(credentialLike).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: Unknown command: token=[REDACTED]\nRun review-artifact --help for usage.\n",
      serverStarted: false,
    });
    expect(credentialLike.stderr).not.toContain("do-not-disclose-this-value");
    expect(whitespaceFlag.stderr).toContain("Unknown command: --token [REDACTED]");
    expect(quotedAssignment.stderr).toContain("Unknown command: password:[REDACTED]");
    expect(affixedCredentials.stderr).toContain("Unknown command: GITHUB_TOKEN=[REDACTED] continue");
    expect(affixedFlag.stderr).toContain("Unknown command: --db-password [REDACTED] --dry-run");
    expect(punctuationAssignment.stderr).toContain("Unknown command: DB_PASSWORD=[REDACTED] migrate");
    expect(prefixedAssignments.stderr).toContain(
      "Unknown command: PROD_API_KEY=[REDACTED] CLIENT_SECRET=[REDACTED] continue",
    );
    expect(followingOption.stderr).toContain("Unknown command: --token --dry-run");
    expect(metric.stderr).toContain("Unknown command: token_count=42 metrics");
    expect(credentialUri.stderr).toContain("Unknown command: postgresql://[REDACTED]@example.com/database");
    expect(authorization.stderr).toContain("Unknown command: Authorization: [REDACTED] next-command --dry-run");
    expect(basicAuthorization.stderr).toContain(
      `Unknown command: curl -H "Authorization: [REDACTED]" https://example.test/basic; printf kept`,
    );
    expect(bearerAuthorization.stderr).toContain(
      `Unknown command: curl -H 'Authorization: [REDACTED]' https://example.test/bearer; printf kept`,
    );
    expect(quotedAuthorization.stderr).toContain(
      `Unknown command: curl -H "Authorization: [REDACTED]" https://example.test/header; printf kept`,
    );
    expect(objectAuthorization.stderr).toContain(
      `Unknown command: {"Authorization":"[REDACTED]","url":"https://example.test/object"}`,
    );
    expect(objectCredentials.stderr).toContain(
      `Unknown command: {"access_token":"[REDACTED]","client_secret":"[REDACTED]","status":"kept"}`,
    );
    expect(compoundKeys.stderr).toContain("AWS_SECRET_ACCESS_KEY=[REDACTED] SSH_PRIVATE_KEY=[REDACTED] private_key_count=7");
    expect(knownToken.stderr).toContain("Unknown command: [REDACTED]");
    expect([
      whitespaceFlag.stderr,
      quotedAssignment.stderr,
      affixedCredentials.stderr,
      affixedFlag.stderr,
      punctuationAssignment.stderr,
      prefixedAssignments.stderr,
      credentialUri.stderr,
      authorization.stderr,
      basicAuthorization.stderr,
      bearerAuthorization.stderr,
      quotedAuthorization.stderr,
      objectAuthorization.stderr,
      objectCredentials.stderr,
      compoundKeys.stderr,
      knownToken.stderr,
    ].join("\n")).not.toMatch(
      /whitespace-separated-secret|quoted secret with spaces|p@ss\/word|db,value|prod key|client secret|uri-secret|fixture-nonce|fixture-response|fixture-basic|fixture-bearer|fixture-custom|fixture-token|fixture-access-value|fixture-client-value|fixture-aws-value|fixture private key|fixtureKnownToken123/,
    );
  });

  test("rejects an empty agent reply before starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-empty-reply-"));
    temporaryDirectories.push(directory);
    const stateDirectory = path.join(directory, "state");

    expect(await runReviewArtifact([
      "poll",
      "specs.html",
      "--agent-reply",
      "",
    ], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: --agent-reply requires a non-empty value\nRun review-artifact poll --help for usage.\n",
      serverStarted: false,
    });
  });

  test("rejects a whitespace-only agent reply before starting the review server", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "review-artifact-whitespace-reply-"));
    temporaryDirectories.push(directory);
    const stateDirectory = path.join(directory, "state");

    expect(await runReviewArtifact([
      "poll",
      "specs.html",
      "--agent-reply",
      " \t ",
    ], stateDirectory)).toEqual({
      exitCode: 2,
      stdout: "",
      stderr: "review-artifact: --agent-reply requires a non-empty value\nRun review-artifact poll --help for usage.\n",
      serverStarted: false,
    });
  });
});

describe("review artifact executable success commands", () => {
  test("opens explicitly with the documented flags and structured output", async () => {
    const fixture = await createProcessFixture();

    const output = await runReviewArtifact(
      ["open", fixture.artifact, "--no-open", "--reopen", "--purpose", "decision"],
      fixture.stateDirectory,
      fixture.environment,
    );

    expect({
      exitCode: output.exitCode,
      stderr: output.stderr,
      body: JSON.parse(output.stdout),
    }).toEqual({
      exitCode: 0,
      stderr: "",
      body: {
        session: {
          file: fixture.canonicalArtifact,
          url: expect.stringContaining(`${fixture.server.baseUrl}/session/`),
          status: "open",
          purpose: "decision",
          mode: "explore",
        },
        nextStep: `Run review-artifact poll ${fixture.canonicalArtifact} to wait for review activity.`,
      },
    });
  });

  test("polls with an agent reply and preserves diagnostic status separation", async () => {
    const fixture = await createProcessFixture();
    const opened = await openFixture(fixture);
    const key = opened.session.url.split("/").at(-1);
    await fetch(`${fixture.server.baseUrl}/api/sessions/${key}/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: fixture.server.baseUrl },
      body: JSON.stringify({ prompts: [{ prompt: "Tighten the heading" }], domSnapshot: "main" }),
    });

    const output = await runReviewArtifact(
      ["poll", fixture.artifact, "--agent-reply", "Updated the introduction"],
      fixture.stateDirectory,
      fixture.environment,
    );

    expect({
      exitCode: output.exitCode,
      stderr: output.stderr,
      body: JSON.parse(output.stdout),
    }).toEqual({
      exitCode: 0,
      stderr: `[review-artifact] Waiting for feedback or approval on ${fixture.canonicalArtifact}. Retry if interrupted.\n`,
      body: {
        status: "feedback",
        prompts: [{ prompt: "Tighten the heading", selector: "", tag: "", text: "" }],
        domSnapshot: "main",
      },
    });
  });

  test("ends an open review with structured output", async () => {
    const fixture = await createProcessFixture();
    await openFixture(fixture);

    const output = await runReviewArtifact(
      ["end", fixture.artifact],
      fixture.stateDirectory,
      fixture.environment,
    );

    expect({ exitCode: output.exitCode, stderr: output.stderr, body: JSON.parse(output.stdout) }).toEqual({
      exitCode: 0,
      stderr: "",
      body: { status: "ended", endedBy: "agent" },
    });
  });

  test("stops a running review server with structured output", async () => {
    const fixture = await createProcessFixture();
    const port = Number(fixture.environment.REVIEW_ARTIFACT_PORT);

    const output = await runReviewArtifact(["stop"], fixture.stateDirectory, fixture.environment);

    expect({ exitCode: output.exitCode, stderr: output.stderr, body: JSON.parse(output.stdout) }).toEqual({
      exitCode: 0,
      stderr: "",
      body: { status: "stopping", port },
    });
  });
});
