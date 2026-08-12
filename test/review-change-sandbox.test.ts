import { describe, expect, test } from "bun:test";

import {
  REVIEW_SANDBOX_MARKER,
  REVIEW_SANDBOX_SIGNAL,
  verifyDocumentedSandbox,
} from "../skills/review-change/runtime/sandbox.mjs";

const verifiedMarker = {
  lstat: async () => ({ isFile: () => true, uid: 0, mode: 0o100644 }),
  realpath: async () => REVIEW_SANDBOX_MARKER,
  readFile: async () => `${REVIEW_SANDBOX_SIGNAL}\n`,
};

describe("Review change documented sandbox verification", () => {
  test("requires both the explicit signal and an immutable root-owned sandbox marker", async () => {
    const environment = { REVIEW_CHANGE_SANDBOX: REVIEW_SANDBOX_SIGNAL };
    const outcomes = await Promise.all([
      verifyDocumentedSandbox({ environment }, verifiedMarker),
      verifyDocumentedSandbox({ environment: {} }, verifiedMarker),
      verifyDocumentedSandbox({ environment }, {
        ...verifiedMarker,
        lstat: async () => ({ isFile: () => true, uid: 501, mode: 0o100644 }),
      }),
      verifyDocumentedSandbox({ environment }, {
        ...verifiedMarker,
        realpath: async () => "/tmp/forged-sandbox-marker",
      }),
      verifyDocumentedSandbox({ environment }, {
        ...verifiedMarker,
        lstat: async () => ({ isFile: () => true, uid: 0, mode: 0o100666 }),
      }),
    ]);

    expect(outcomes).toEqual([true, false, false, false, false]);
  });
});
