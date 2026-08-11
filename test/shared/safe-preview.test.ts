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
      "apiKey=fixture-camel-api-value",
      "clientSecret: fixture-camel-client-value",
      "postgresql://alice:uri-secret@example.com/database",
    ].join("\n");

    expect(redactCredentials(diagnostic)).toBe([
      "deploy --github-token [REDACTED] continue",
      "--db-password [REDACTED] --dry-run",
      "GITHUB_TOKEN=[REDACTED] next-command",
      "DB_PASSWORD: [REDACTED] migrate",
      "report-secret unrelated-tail",
      "client_secret: [REDACTED]",
      "apiKey=[REDACTED]",
      "clientSecret: [REDACTED]",
      "postgresql://[REDACTED]@example.com/database",
    ].join("\n"));
  });

  test("classifies acronym credentials without consuming camel-case metrics", () => {
    const diagnostic = [
      "APIKey=fixture-acronym-api-value",
      "OAuthToken: fixture-acronym-token-value",
      "apiKeyCount=42",
      "clientSecretAge=30",
    ].join("\n");

    expect(redactCredentials(diagnostic)).toBe([
      "APIKey=[REDACTED]",
      "OAuthToken: [REDACTED]",
      "apiKeyCount=42",
      "clientSecretAge=30",
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
      "Authoriza\ttion: Basic fixture-layout-authorization==",
      "Bea\nrer fixture-layout-bearer",
      "Authorization: Bearer\r\n fixture-folded-authorization",
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
      "Authoriza\ttion: [REDACTED]",
      "Bea\nrer [REDACTED]",
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

  test("normalizes terminal controls before matching credential names", () => {
    const diagnostic = [
      "GITHUB_\u001b[31mTOKEN=fixture-csi-value",
      "DB_\u001b]0;window-title\u0007PASSWORD=fixture-osc-value",
      "PROD_API_\tKEY=fixture-tab-value",
      "AWS_SECRET_ACCESS_\r\nKEY=fixture-line-value",
      "GITHUB_TO\tKEN=fixture-interior-value",
      "--client_se\ncret fixture-flag-value continue",
      "--\tGITHUB_TOKEN fixture-leading-flag-value continue",
      "--GITHUB_TOKEN\tfixture-trailing-flag-value --dry-run",
      "{\"access_to\tken\":\"fixture-object-value\",\"status\":\"kept\"}",
      "{\"\tclient_secret\r\":\"fixture-boundary-object-value\",\"status\":\"kept\"}",
    ].join("\n");

    expect(redactCredentials(diagnostic)).toBe([
      "GITHUB_TOKEN=[REDACTED]",
      "DB_PASSWORD=[REDACTED]",
      "PROD_API_\tKEY=[REDACTED]",
      "AWS_SECRET_ACCESS_\r\nKEY=[REDACTED]",
      "GITHUB_TO\tKEN=[REDACTED]",
      "--client_se\ncret [REDACTED] continue",
      "--\tGITHUB_TOKEN [REDACTED] continue",
      "--GITHUB_TOKEN\t[REDACTED] --dry-run",
      "{\"access_to\tken\":\"[REDACTED]\",\"status\":\"kept\"}",
      "{\"\tclient_secret\r\":\"[REDACTED]\",\"status\":\"kept\"}",
    ].join("\n"));
  });

  test("redacts generic credentials only across horizontal or indented value layout", () => {
    const forms = [
      {
        withValue: (layout: string) => `--token${layout}fixture-flag-value`,
        redacted: (layout: string) => `--token${layout}[REDACTED]`,
        withoutValue: (lineEnding: string) => `--token${lineEnding}build failed`,
      },
      {
        withValue: (layout: string) => `GITHUB_TOKEN=${layout}fixture-assignment-value`,
        redacted: (layout: string) => `GITHUB_TOKEN=${layout}[REDACTED]`,
        withoutValue: (lineEnding: string) => `GITHUB_TOKEN=${lineEnding}build failed`,
      },
      {
        withValue: (layout: string) => `{"access_token":${layout}"fixture-object-value"}`,
        redacted: (layout: string) => `{"access_token":${layout}"[REDACTED]"}`,
        withoutValue: (lineEnding: string) => `{"access_token":${lineEnding}build failed`,
      },
    ];
    const valueLayouts = [" ", "\n ", "\r ", "\r\n "];
    const lineEndings = ["\n", "\r", "\r\n"];

    const redactedValues = forms.flatMap((form) => valueLayouts.map((layout) => ({
      actual: redactCredentials(form.withValue(layout)),
      expected: form.redacted(layout),
    })));
    const preservedRecords = forms.flatMap((form) => lineEndings.map((lineEnding) => {
      const diagnostic = form.withoutValue(lineEnding);
      return { actual: redactCredentials(diagnostic), expected: diagnostic };
    }));

    expect([...redactedValues, ...preservedRecords].every(({ actual, expected }) => actual === expected)).toBe(true);
  });

  test("preserves non-indented records after empty Authorization fields", () => {
    const diagnostics = ["\n", "\r", "\r\n"].map(
      (lineEnding) => `Authorization:${lineEnding}build failed`,
    );

    expect(diagnostics.map(redactCredentials)).toEqual(diagnostics);
  });

  test("preserves ordinary short diagnostics", () => {
    expect(redactCredentials("Unknown option for open: --opeen")).toBe("Unknown option for open: --opeen");
  });
});
