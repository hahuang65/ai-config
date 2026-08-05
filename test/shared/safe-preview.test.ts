import { describe, expect, test } from "bun:test";

import { redactCredentials } from "../../skills/shared/runtime/safe-preview.mjs";

describe("shared credential redaction", () => {
  test("redacts affixed credential flags, assignments, and URI userinfo", () => {
    const diagnostic = [
      "deploy --github-token whitespace-secret continue",
      "--db-password \"quoted secret with spaces\" --dry-run",
      "GITHUB_TOKEN=p@ss/word:.+!?[]{}() next-command",
      "DB_PASSWORD: 'assigned secret with spaces' migrate",
      "report-secret unrelated-tail",
      "client_secret: \"colon secret with spaces\"",
      "postgresql://alice:uri-secret@example.com/database",
    ].join("\n");

    expect(redactCredentials(diagnostic)).toBe([
      "deploy --github-token [REDACTED] continue",
      "--db-password [REDACTED] --dry-run",
      "GITHUB_TOKEN=[REDACTED] next-command",
      "DB_PASSWORD: [REDACTED] migrate",
      "report-secret unrelated-tail",
      "client_secret: [REDACTED]",
      "postgresql://[REDACTED]@example.com/database",
    ].join("\n"));
  });

  test("classifies credential names and values without consuming metrics or following options", () => {
    const knownToken = `gh${"p"}_${"fixtureKnownToken123"}`;
    const diagnostic = [
      "GITHUB_TOKEN=github-value next",
      "DB_PASSWORD=db,value;with-punctuation migrate",
      "PROD_API_KEY='prod key with spaces' deploy",
      "CLIENT_SECRET=\"client secret with spaces\" continue",
      "--db-password flag,value;with-punctuation --execute",
      "--client_secret 'quoted flag with spaces' finish",
      "--token --dry-run",
      "token_count=42 metrics",
      "postgresql://alice:uri-secret@example.com/database",
      knownToken,
    ].join("\n");

    expect(redactCredentials(diagnostic)).toBe([
      "GITHUB_TOKEN=[REDACTED] next",
      "DB_PASSWORD=[REDACTED] migrate",
      "PROD_API_KEY=[REDACTED] deploy",
      "CLIENT_SECRET=[REDACTED] continue",
      "--db-password [REDACTED] --execute",
      "--client_secret [REDACTED] finish",
      "--token --dry-run",
      "token_count=42 metrics",
      "postgresql://[REDACTED]@example.com/database",
      "[REDACTED]",
    ].join("\n"));
  });

  test("redacts complete Authorization payloads and established compound key names without crossing records", () => {
    const awsSecretAccessKey = ["AWS", "SECRET", "ACCESS", "KEY"].join("_");
    const diagnostic = [
      "Authorization: Digest username=\"fixture-user\", realm=\"example\", nonce=\"fixture-nonce\", response=\"fixture-response\"",
      "next-command --dry-run",
      "Authorization: Custom fixture-part-one fixture-part-two",
      "following-record",
      `${awsSecretAccessKey}=fixture-aws-value deploy`,
      "SSH_PRIVATE_KEY='fixture private key' publish",
      "SECRET_KEY=fixture-secret-key rotate",
      "aws_secret_access_key_count=42 metrics",
      "private_key_count=7 metrics",
      "secret_key_age=30 metrics",
    ].join("\n");

    expect(redactCredentials(diagnostic)).toBe([
      "Authorization: [REDACTED]",
      "next-command --dry-run",
      "Authorization: [REDACTED]",
      "following-record",
      `${awsSecretAccessKey}=[REDACTED] deploy`,
      "SSH_PRIVATE_KEY=[REDACTED] publish",
      "SECRET_KEY=[REDACTED] rotate",
      "aws_secret_access_key_count=42 metrics",
      "private_key_count=7 metrics",
      "secret_key_age=30 metrics",
    ].join("\n"));
  });

  test("redacts quoted Authorization values without consuming shell and object boundaries", () => {
    const diagnostic = [
      `{"Authorization":"Basic fixture-basic==","url":"https://example.test/api"}`,
      `{'Authorization': 'Bearer fixture-bearer', 'status': 'kept'}`,
      `{Authorization: "Token fixture-token", endpoint: "https://example.test/object"}`,
      `curl -H "Authorization: Custom fixture-custom" https://example.test/header; printf kept`,
      `curl --header='Authorization: Bearer fixture-shell' https://example.test/shell; next-command`,
      `Authorization: Basic fixture-bare; next-command --url https://example.test/bare`,
    ].join("\n");

    expect(redactCredentials(diagnostic)).toBe([
      `{"Authorization":"[REDACTED]","url":"https://example.test/api"}`,
      `{'Authorization': '[REDACTED]', 'status': 'kept'}`,
      `{Authorization: "[REDACTED]", endpoint: "https://example.test/object"}`,
      `curl -H "Authorization: [REDACTED]" https://example.test/header; printf kept`,
      `curl --header='Authorization: [REDACTED]' https://example.test/shell; next-command`,
      `Authorization: [REDACTED]; next-command --url https://example.test/bare`,
    ].join("\n"));
  });

  test("redacts quoted object credential keys while preserving object delimiters", () => {
    const diagnostic = [
      `{"access_token":"fixture-access-value","status":"kept"}`,
      `{'client_secret': 'fixture-client-value', 'count': 2}`,
      `{"access_token_count":"42","client_secret_age":"30"}`,
    ].join("\n");

    expect(redactCredentials(diagnostic)).toBe([
      `{"access_token":"[REDACTED]","status":"kept"}`,
      `{'client_secret': '[REDACTED]', 'count': 2}`,
      `{"access_token_count":"42","client_secret_age":"30"}`,
    ].join("\n"));
  });

  test("preserves ordinary short diagnostics", () => {
    expect(redactCredentials("Unknown option for open: --opeen")).toBe("Unknown option for open: --opeen");
  });
});
