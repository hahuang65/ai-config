import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../", import.meta.url);

async function source(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, ROOT), "utf8");
}

test("the baseline loads A5 guidance only for relevant A5 work", async () => {
  const baseline = await source("baseline-prompt.md");

  expect(baseline).toContain(
    "`a5.md` — in an A5 project, before authenticating AWS services, renewing IAM credentials, or managing local development containers",
  );
});

test("the A5 rule prefers project shortcuts and explains each approved command", async () => {
  const rule = await source("rules/a5.md");
  const expectedGuidance = [
    "`a5 auth codeartifact` authenticates with AWS CodeArtifact",
    "`a5 auth ecr` authenticates with Amazon Elastic Container Registry (ECR)",
    "`a5 creds renew` renews the project's existing AWS Identity and Access Management (IAM) credentials",
    "`a5 docker up` starts the local development containers",
    "`a5 docker down` stops the local development containers",
    "`a5 docker ps` shows the local development containers",
    "`a5 docker logs` shows logs from the local development containers",
    "`a5 docker run` runs a local development container",
  ];

  expect(rule).toContain("Use the `a5` commands instead of the underlying commands or scripts when an A5 project task has an equivalent shortcut.");
  for (const guidance of expectedGuidance) {
    expect(rule).toContain(guidance);
  }
});
