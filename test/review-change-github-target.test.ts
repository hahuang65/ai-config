import { describe, expect, test } from "bun:test";

import {
  canonicalGitHubSshUrl,
  parseGitHubRepositoryUrl,
  parseGitHubTarget,
} from "../skills/review-change/runtime/github-target.mjs";

describe("Review change GitHub target parsing", () => {
  test("normalizes a canonical GitHub pull-request URL", () => {
    expect(parseGitHubTarget("https://github.com/acme/app/pull/42")).toEqual({
      kind: "pull-request",
      owner: "acme",
      repository: "app",
      number: 42,
    });
  });

  test("ignores a pull-request tab path, query, and fragment", () => {
    expect(parseGitHubTarget("https://github.com/acme/app/pull/42/changes?diff=split#discussion")).toEqual({
      kind: "pull-request",
      owner: "acme",
      repository: "app",
      number: 42,
    });
  });

  test("normalizes a concise GitHub pull-request identifier", () => {
    expect(parseGitHubTarget("gh:acme/app/pull/42")).toEqual({
      kind: "pull-request",
      owner: "acme",
      repository: "app",
      number: 42,
    });
  });

  test("rejects URL-only modifiers on concise GitHub identifiers", () => {
    const invalidTargets = [
      "gh:acme/app/pull/42/changes",
      "gh:acme/app/pull/42/",
      "gh:acme/app/pull/42?diff=split",
      "gh:acme/app/pull/42#discussion",
      "gh:acme/app/tree/feature/cli/",
      "gh:acme/app/tree/feature/cli?plain=1",
      "gh:acme/app/tree/feature/cli#readme",
    ];

    for (const target of invalidTargets) expect(() => parseGitHubTarget(target)).toThrow("malformed");
  });

  test("rejects dot-segment normalization in concise GitHub paths", () => {
    const invalidTargets = [
      "gh:acme/app/./pull/42",
      "gh:acme/app/section/../pull/42",
      "gh:acme/app/tree/feature/./cli",
      "gh:acme/app/tree/feature/../cli",
      "gh:acme/app/tree/feature/%2e/cli",
      "gh:acme/app/tree/feature/%2E%2E/cli",
    ];

    for (const target of invalidTargets) expect(() => parseGitHubTarget(target)).toThrow("malformed");
  });

  test("rejects a GitHub URL with embedded credentials", () => {
    expect(() => parseGitHubTarget("https://token:secret@github.com/acme/app/pull/42"))
      .toThrow("must not include credentials");
  });

  test("rejects noncanonical GitHub browser origins and ambiguous endpoints", () => {
    const invalidTargets = [
      "https://github.com:8443/acme/app/pull/42",
      "https://github.com./acme/app/pull/42",
      "https://github.com/acme/app/pull/42%2fchanges",
      "https://github.com/acme//app/pull/42",
      "https://github.com/acme/other/../app/pull/42",
      "https://github.com/acme/app/./pull/42",
    ];

    for (const target of invalidTargets) expect(() => parseGitHubTarget(target)).toThrow("malformed");
  });

  test("preserves a slash-bearing GitHub branch name", () => {
    expect(parseGitHubTarget("https://github.com/acme/app/tree/av/upgrade-to-uv")).toEqual({
      kind: "branch",
      owner: "acme",
      repository: "app",
      branch: "av/upgrade-to-uv",
    });
  });

  test("normalizes the equivalent concise GitHub branch identifier", () => {
    expect(parseGitHubTarget("gh:acme/app/tree/av/upgrade-to-uv")).toEqual({
      kind: "branch",
      owner: "acme",
      repository: "app",
      branch: "av/upgrade-to-uv",
    });
  });

  test("formats canonical SSH identity for effective Git classification", () => {
    expect(canonicalGitHubSshUrl({ owner: "summit-partners", repository: "news-service" }))
      .toBe("git@github.com:summit-partners/news-service.git");
  });

  test("accepts only documented GitHub remote transports on canonical or default ports", () => {
    const accepted = [
      "git@github.com:acme/app.git",
      "ssh://git@github.com/acme/app.git",
      "ssh://git@github.com:22/acme/app.git",
      "https://github.com/acme/app.git",
      "https://github.com:443/acme/app.git",
    ];
    const rejected = [
      "http://github.com/acme/app.git",
      "git://github.com/acme/app.git",
      "ssh://alice@github.com/acme/app.git",
      "ssh://git@github.com:2222/acme/app.git",
      "https://token@github.com/acme/app.git",
      "https://github.com:8443/acme/app.git",
      "https://github.com./acme/app.git",
    ];

    for (const remote of accepted) expect(parseGitHubRepositoryUrl(remote)).toEqual({ owner: "acme", repository: "app" });
    for (const remote of rejected) expect(parseGitHubRepositoryUrl(remote)).toBeNull();
  });

  test("rejects raw control characters in every documented GitHub remote transport", () => {
    const controlCharacters = ["\0", "\u0001", "\t", "\r", "\n", "\u001f", "\u007f", "\u0085"];
    const remoteTemplates = [
      (controlCharacter: string) => `https://github.com/ac${controlCharacter}me/app.git`,
      (controlCharacter: string) => `ssh://git@github.com/ac${controlCharacter}me/app.git`,
      (controlCharacter: string) => `git@github.com:ac${controlCharacter}me/app.git`,
    ];

    for (const controlCharacter of controlCharacters) {
      for (const remoteTemplate of remoteTemplates) {
        expect(parseGitHubRepositoryUrl(remoteTemplate(controlCharacter))).toBeNull();
      }
    }
  });

  test("rejects normalization-sensitive raw paths in documented GitHub remotes", () => {
    const invalidRemotes = [
      "https://github.com/acme//app.git",
      "https://github.com/acme/./app.git",
      "https://github.com/acme/../app.git",
      "https://github.com/acme\\app.git",
      "https://github.com\\acme/app.git",
      "https://github.com/acme%2Fother/app.git",
      "ssh://git@github.com/acme//app.git",
      "ssh://git@github.com/acme/./app.git",
      "ssh://git@github.com/acme/../app.git",
      "ssh://git@github.com/acme\\app.git",
      "ssh://git@github.com\\acme/app.git",
      "ssh://git@github.com/acme%5Cother/app.git",
    ];

    for (const remote of invalidRemotes) expect(parseGitHubRepositoryUrl(remote)).toBeNull();
  });

  test("accepts only canonical positive pull-request decimals within the explicit bound", () => {
    expect(parseGitHubTarget("gh:acme/app/pull/2147483647").number).toBe(2_147_483_647);

    for (const number of ["0", "00", "01", "+1", "2147483648", "9007199254740992"]) {
      expect(() => parseGitHubTarget(`gh:acme/app/pull/${number}`)).toThrow("malformed");
    }
  });

  test("rejects encoded separators and malformed GitHub repository identities", () => {
    const invalidTargets = [
      "gh:acme%2Fother/app/pull/42",
      "gh:acme/app%2Fother/pull/42",
      "gh:acme/app%5Cother/pull/42",
      "gh:-acme/app/pull/42",
      "gh:acme-/app/pull/42",
      "gh:acme--labs/app/pull/42",
      "gh:acme_labs/app/pull/42",
      "gh:acme/app~service/pull/42",
      `gh:${"a".repeat(40)}/app/pull/42`,
      `gh:acme/${"a".repeat(101)}/pull/42`,
    ];

    for (const target of invalidTargets) expect(() => parseGitHubTarget(target)).toThrow("malformed");
  });

  test("rejects malformed and unsupported pull-request targets", () => {
    const invalidTargets = [
      "http://github.com/acme/app/pull/42",
      "https://gitlab.com/acme/app/pull/42",
      "gh:acme/app/pulls/42",
      "gh:acme/app/pull/not-a-number",
    ];

    for (const target of invalidTargets) expect(() => parseGitHubTarget(target)).toThrow("malformed");
  });

  test("rejects an oversized GitHub target", () => {
    const oversizedOwner = "a".repeat(2_049);

    expect(() => parseGitHubTarget(`https://github.com/${oversizedOwner}/app/pull/42`))
      .toThrow("too long");
  });

  test("rejects every control-character range before URL normalization", () => {
    const controlCharacters = ["\u0001", "\t", "\n", "\u007f", "\u0085"];

    for (const controlCharacter of controlCharacters) {
      expect(() => parseGitHubTarget(`https://github.com/acme/app/pull/${controlCharacter}42`))
        .toThrow("one non-empty line");
    }
  });
});
