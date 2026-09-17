import {
  createOperatingSystemConfirmation,
  createOperatingSystemPromptRunner,
} from "./review-publication-os-confirmation.mjs";
import {
  validateGitHubCliPath,
  validateTrustedExecutablePath,
} from "./review-publication-executable.mjs";
import { handleInetdRequest, relayInetdRequest } from "./review-publication-inetd.mjs";
import { createGitHubProvider } from "./review-publication-provider.mjs";
import { createReviewPublicationServer } from "./review-publication-server.mjs";
import { loadPublicationKey, withPublisherLock } from "./review-publication-state.mjs";
import { loadReviewPublicationWorkerConfiguration } from "./review-publication-worker-config.mjs";

export async function runReviewPublicationRequest({
  input = process.stdin,
  output = process.stdout,
  home,
  loadConfiguration = loadReviewPublicationWorkerConfiguration,
  loadKey = loadPublicationKey,
  providerFactory = createGitHubProvider,
  serverFactory = createReviewPublicationServer,
} = {}) {
  await handleInetdRequest({
    input,
    output,
    dispatch: async (request, context) => {
      const worker = await initializeWorker({
        home,
        loadConfiguration,
        loadKey,
        providerFactory,
      });
      const server = await initializeStage(() => serverFactory({
        key: worker.key,
        ...worker.provider,
        publishReview: worker.provider.publishReview,
        confirmPublication: worker.confirmPublication,
        requestContext: context,
        withPublicationLock: (claims, task, lockContext) => withPublisherLock(claims, task, {
          signal: lockContext.signal,
          onCleanupFailure: lockContext.markCleanupTrouble,
        }),
        expectedHost: "127.0.0.1:4392",
      }), "publisher_initialization_failed");
      try {
        return await relayInetdRequest(server.url, request, context.signal);
      } finally {
        await server.close();
      }
    },
  });
}

async function initializeWorker({ home, loadConfiguration, loadKey, providerFactory }) {
  const configuration = await initializeStage(
    () => loadConfiguration(home === undefined ? {} : { home }),
    "publisher_configuration_invalid",
  );
  const key = await initializeStage(
    () => loadKey(home === undefined ? {} : { home }),
    "publisher_signing_key_unavailable",
  );
  const githubExecutable = await initializeStage(
    () => validateGitHubCliPath(configuration.githubExecutable),
    "provider_unavailable",
  );
  const confirmationExecutable = await initializeStage(
    () => validateTrustedExecutablePath(configuration.confirmationExecutable),
    "os_confirmation_unavailable",
  );
  const provider = await initializeStage(
    () => providerFactory({ ghPath: githubExecutable }),
    "publisher_initialization_failed",
  );
  const confirmPublication = await initializeStage(() => createOperatingSystemConfirmation({
    promptRunner: createOperatingSystemPromptRunner({
      platform: configuration.platform,
      executable: confirmationExecutable,
    }),
  }), "publisher_initialization_failed");
  return { confirmPublication, key, provider };
}

async function initializeStage(operation, code) {
  try {
    return await operation();
  } catch {
    throw Object.assign(new Error(code), {
      code,
      status: 503,
      publicationResponseError: true,
    });
  }
}
