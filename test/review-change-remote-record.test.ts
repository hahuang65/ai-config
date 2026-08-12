import { afterAll, describe, expect, test } from "bun:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { runReviewChange } from "../skills/review-change/runtime/runner.mjs";
import {
  createReviewWorkspace,
  safeRemoteUrlRecord,
} from "../skills/review-change/runtime/workspace.mjs";
import { ISOLATED_GIT_ENV } from "./git-environment";

const executeFile = promisify(execFile);
const git = (args: string[]) => executeFile("git", args, { env: ISOLATED_GIT_ENV, timeout: 10_000 });
const cleanupRoots: string[] = [];

const forbiddenControls = [
  ...Array.from({ length: 0x20 }, (_value, codePoint) => String.fromCodePoint(codePoint)),
  "\u007f",
  ...Array.from({ length: 0x20 }, (_value, index) => String.fromCodePoint(0x80 + index)),
];
const remoteUrls = [
  "https://github.com/acme/app.git",
  "ssh://git@github.com/acme/app.git",
  "git@github.com:acme/app.git",
];

afterAll(async () => {
  await Promise.all(cleanupRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("matching-remote raw URL records", () => {
  test("removes only one Git terminator from a valid remote URL record", () => {
    expect(remoteUrls.map((remoteUrl) => safeRemoteUrlRecord(`${remoteUrl}\n`))).toEqual(remoteUrls);
  });

  test("rejects every leading, trailing, and embedded C0, C1, or DEL control before URL normalization", () => {
    const accepted: string[] = [];

    for (const remoteUrl of remoteUrls) {
      const separator = remoteUrl.startsWith("git@") ? ":" : "/";
      const embeddedIndex = remoteUrl.lastIndexOf(separator) + 1;
      for (const control of forbiddenControls) {
        const malformedRecords = [
          `${control}${remoteUrl}\n`,
          `${remoteUrl}${control}\n`,
          `${remoteUrl.slice(0, embeddedIndex)}${control}${remoteUrl.slice(embeddedIndex)}\n`,
        ];
        for (const record of malformedRecords) {
          if (safeRemoteUrlRecord(record) !== null) accepted.push(JSON.stringify(record));
        }
      }
    }

    expect(accepted).toEqual([]);
  });

  test("does not treat an extra line ending as the one Git output terminator", () => {
    expect(safeRemoteUrlRecord("https://github.com/acme/app.git\n\n")).toBeNull();
    expect(safeRemoteUrlRecord("https://github.com/acme/app.git\r\n")).toBeNull();
  });

  test("stops malformed matching-remote freshness before fetch or child evidence and cleans isolation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "review-change-raw-remote-record-"));
    const source = path.join(root, "source");
    const reviewRoot = path.join(root, "reviews");
    const decoy = path.join(reviewRoot, "keep-this-path");
    const activity: string[] = [];
    let childEvidenceRuns = 0;
    cleanupRoots.push(root);

    await git(["init", "-b", "feature", source]);
    await git(["-C", source, "config", "user.name", "Test User"]);
    await git(["-C", source, "config", "user.email", "test@example.invalid"]);
    await writeFile(path.join(source, "tracked.txt"), "source\n");
    await git(["-C", source, "add", "tracked.txt"]);
    await git(["-C", source, "commit", "-m", "source"]);
    await git(["-C", source, "remote", "add", "origin", pathToFileURL(source).href]);
    await git(["-C", source, "remote", "add", "upstream", "\thttps://127.0.0.1:1/acme/app.git"]);
    await git(["-C", source, "config", "branch.feature.remote", "upstream"]);
    await git(["-C", source, "config", "branch.feature.merge", "refs/heads/feature"]);
    await mkdir(decoy, { recursive: true });

    await expect(runReviewChange(
      { target: "feature", intent: null, piOptions: [] },
      {
        environment: {},
        cwd: source,
        isGitRepository: async () => true,
        status: {
          start() {}, begin() {}, succeed() {}, fail() {}, finish() {}, setWorkspacePath() {},
          activity: (_stage, kind, message) => activity.push(`${kind}:${message}`),
        },
        resolveTarget: async ({ cwd }) => cwd === source
          ? { kind: "local-branch", target: "feature", freshnessRemote: "upstream" }
          : { kind: "local-range", target: `${"a".repeat(40)}...${"b".repeat(40)}` },
        createWorkspace: (options) => createReviewWorkspace({ ...options, reviewRoot }),
        createReportDirectory: async () => path.join(root, "report"),
        spawnProcess: async () => { childEvidenceRuns += 1; return 0; },
      },
    )).rejects.toThrow("credential-safe upstream fetch URL");

    expect({
      fetched: activity.some((entry) => entry.includes(" fetch upstream")),
      childEvidenceRuns,
      retainedPaths: await readdir(reviewRoot),
    }).toEqual({ fetched: false, childEvidenceRuns: 0, retainedPaths: ["keep-this-path"] });
  });
});
