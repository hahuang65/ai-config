import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  boundedPreview,
  credentialRedactedPreview,
  redactCredentials,
} from "../skills/shared/runtime/safe-preview.mjs";

const FAILURE_PREVIEW_CHARACTERS = 8_000;
const FAILURE_LOG_PREFIX = "ai-config-test-failures-";
const FAILURE_LOG_NAME = "failures.log";

export async function reportLaneFailures(failures, options = {}) {
  if (failures.length === 0) return Object.freeze({ fullLogPath: null, omittedCharacters: 0 });

  const completeLog = redactCredentials(formatFailureLog(failures));
  const preview = boundedPreview(completeLog, FAILURE_PREVIEW_CHARACTERS);
  const persisted = await persistFailureLog(
    completeLog,
    options.temporaryRoot ?? tmpdir(),
    options.makeTemporaryDirectory ?? mkdtemp,
  );
  const writeDiagnostic = options.writeDiagnostic ?? ((text) => process.stderr.write(text));
  writeDiagnostic(formatDiagnostic(failures, preview, persisted));
  return Object.freeze({
    fullLogPath: persisted.path,
    omittedCharacters: preview.omittedCharacters,
  });
}

function formatFailureLog(failures) {
  return failures.map((failure) => {
    const header = `── ${failure.name} failed with exit ${failure.exitCode} ──`;
    const streams = [
      failure.stdout ? `stdout:\n${failure.stdout}` : "",
      failure.stderr ? `stderr:\n${failure.stderr}` : "",
    ].filter(Boolean);
    return [header, ...streams].join("\n");
  }).join("\n\n");
}

async function persistFailureLog(content, temporaryRoot, makeTemporaryDirectory) {
  try {
    const directory = await makeTemporaryDirectory(path.join(temporaryRoot, FAILURE_LOG_PREFIX));
    await chmod(directory, 0o700);
    const logPath = path.join(directory, FAILURE_LOG_NAME);
    await writeFile(logPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
    return Object.freeze({ path: logPath, error: null });
  } catch (error) {
    const preview = credentialRedactedPreview(errorMessage(error), 300);
    return Object.freeze({ path: null, error: preview.text });
  }
}

function formatDiagnostic(failures, preview, persisted) {
  const summary = failures
    .map(({ exitCode, name }) => `  ✗ ${name} (exit ${exitCode})`)
    .join("\n");
  const recovery = persisted.path
    ? `Full failure log: ${persisted.path}`
    : `Full failure log unavailable: ${persisted.error}`;
  return `\n  ── failed test lanes ──\n\n${summary}\n\n${preview.text}\n\n${recovery}\n`;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
