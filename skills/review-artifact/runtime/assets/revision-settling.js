import { captureArtifactRevision } from "./artifact-revision.js";

const DEFAULT_FONT_TIMEOUT_MS = 2_000;
const DEFAULT_QUIET_MS = 180;
const DEFAULT_SETTLEMENT_TIMEOUT_MS = 2_500;

export async function captureSettledArtifactRevision(root, options = {}) {
  const documentRef = root.ownerDocument;
  const quietMs = options.quietMs ?? DEFAULT_QUIET_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_SETTLEMENT_TIMEOUT_MS;
  const settlement = observeMutations(root);
  try {
    await waitForFonts(documentRef, options.fontTimeoutMs ?? DEFAULT_FONT_TIMEOUT_MS);
    await waitForQuietDom(settlement, quietMs, timeoutMs);
    return captureArtifactRevision(root, options.limits);
  } finally {
    settlement.observer.disconnect();
  }
}

function observeMutations(root) {
  const settlement = { lastMutationAt: performance.now(), observer: null };
  settlement.observer = new MutationObserver(() => {
    settlement.lastMutationAt = performance.now();
  });
  settlement.observer.observe(root, {
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
  return settlement;
}

async function waitForQuietDom(settlement, quietMs, timeoutMs) {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const remainingQuiet = quietMs - (performance.now() - settlement.lastMutationAt);
    if (remainingQuiet > 0) {
      await delay(Math.min(remainingQuiet, quietMs));
      continue;
    }
    await nextFrame();
    await nextFrame();
    if (settlement.observer.takeRecords().length === 0
      && performance.now() - settlement.lastMutationAt >= quietMs) return;
    settlement.lastMutationAt = performance.now();
  }
  throw new ArtifactRevisionSettleError();
}

async function waitForFonts(documentRef, timeoutMs) {
  try {
    await Promise.race([documentRef.fonts?.ready ?? Promise.resolve(), delay(timeoutMs)]);
  } catch {
    // DOM quiet detection remains authoritative when font readiness fails.
  }
}

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ArtifactRevisionSettleError extends Error {
  constructor() {
    super("Artifact revision did not settle before the timeout");
    this.name = "ArtifactRevisionSettleError";
  }
}
