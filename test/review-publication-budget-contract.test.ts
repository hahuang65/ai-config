import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import {
  CLEANUP_TIMEOUT_MS,
  LOCK_WAIT_TIMEOUT_MS,
  OS_CONFIRMATION_TIMEOUT_MS,
  POST_ABORT_RECONCILIATION_TIMEOUT_MS,
  PROCESS_TERMINATION_GRACE_MS,
  PROVIDER_CALL_TIMEOUT_MS,
  REQUEST_WORK_TIMEOUT_MS,
  RESPONSE_FLUSH_TIMEOUT_MS,
  SERVICE_SHUTDOWN_TIMEOUT_SECONDS,
  TOTAL_SERVICE_LIFETIME_MS,
  TOTAL_SERVICE_LIFETIME_SECONDS,
} from "../skills/review-change/runtime/review-publication-lifetime.mjs";

test("Review publication defines one internally consistent lifetime budget contract", () => {
  const providerLifetime = PROVIDER_CALL_TIMEOUT_MS + PROCESS_TERMINATION_GRACE_MS;
  const maximumReconciliationProviderRounds = 3;
  const boundedLifetime = REQUEST_WORK_TIMEOUT_MS
    + POST_ABORT_RECONCILIATION_TIMEOUT_MS
    + RESPONSE_FLUSH_TIMEOUT_MS
    + CLEANUP_TIMEOUT_MS * 2;

  expect({
    positiveBudgets: [
      CLEANUP_TIMEOUT_MS,
      LOCK_WAIT_TIMEOUT_MS,
      OS_CONFIRMATION_TIMEOUT_MS,
      POST_ABORT_RECONCILIATION_TIMEOUT_MS,
      PROCESS_TERMINATION_GRACE_MS,
      PROVIDER_CALL_TIMEOUT_MS,
      REQUEST_WORK_TIMEOUT_MS,
      RESPONSE_FLUSH_TIMEOUT_MS,
    ].every((budget) => Number.isSafeInteger(budget) && budget > 0),
    lockFitsRequest: LOCK_WAIT_TIMEOUT_MS < REQUEST_WORK_TIMEOUT_MS,
    confirmationFitsRequest: OS_CONFIRMATION_TIMEOUT_MS + PROCESS_TERMINATION_GRACE_MS < REQUEST_WORK_TIMEOUT_MS,
    reconciliationCoversProviderRounds:
      POST_ABORT_RECONCILIATION_TIMEOUT_MS >= providerLifetime * maximumReconciliationProviderRounds,
    serviceHasTerminationMargin: TOTAL_SERVICE_LIFETIME_MS > boundedLifetime,
    exactServiceSeconds: TOTAL_SERVICE_LIFETIME_SECONDS * 1_000 === TOTAL_SERVICE_LIFETIME_MS,
    shutdownFitsServiceMargin:
      SERVICE_SHUTDOWN_TIMEOUT_SECONDS * 1_000 <= TOTAL_SERVICE_LIFETIME_MS - boundedLifetime,
  }).toEqual({
    positiveBudgets: true,
    lockFitsRequest: true,
    confirmationFitsRequest: true,
    reconciliationCoversProviderRounds: true,
    serviceHasTerminationMargin: true,
    exactServiceSeconds: true,
    shutdownFitsServiceMargin: true,
  });
});

test("service templates derive their lifetime and shutdown bounds from the shared contract", async () => {
  const [service, launchd, renderer] = await Promise.all([
    readFile(new URL("../review-publication/review-publication@.service", import.meta.url), "utf8"),
    readFile(new URL("../review-publication/dev.review-publication.plist", import.meta.url), "utf8"),
    readFile(new URL("../review-publication/render-installation.mjs", import.meta.url), "utf8"),
  ]);

  expect({
    serviceLifetimePlaceholders:
      service.includes("RuntimeMaxSec=__SERVICE_LIFETIME_SECONDS__s")
      && service.includes("TimeoutStartSec=__SERVICE_LIFETIME_SECONDS__s"),
    serviceShutdownPlaceholder: service.includes("TimeoutStopSec=__SERVICE_SHUTDOWN_TIMEOUT_SECONDS__s"),
    launchdShutdownPlaceholder:
      launchd.includes("<integer>__SERVICE_SHUTDOWN_TIMEOUT_SECONDS__</integer>"),
    rendererOwnsSharedBudgets:
      renderer.includes("TOTAL_SERVICE_LIFETIME_SECONDS")
      && renderer.includes("SERVICE_SHUTDOWN_TIMEOUT_SECONDS"),
  }).toEqual({
    serviceLifetimePlaceholders: true,
    serviceShutdownPlaceholder: true,
    launchdShutdownPlaceholder: true,
    rendererOwnsSharedBudgets: true,
  });
});
