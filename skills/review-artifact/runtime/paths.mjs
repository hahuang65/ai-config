import os from "node:os";
import path from "node:path";

const DEFAULT_PORT = 4391;

export function reviewPort(env = process.env) {
  const port = Number(env.REVIEW_ARTIFACT_PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("REVIEW_ARTIFACT_PORT must be an integer from 1 to 65535");
  }
  return port;
}

export function stateDirectory(env = process.env) {
  return path.resolve(env.REVIEW_ARTIFACT_STATE_DIR ?? path.join(os.homedir(), ".review-artifact"));
}

export function stateFile(env = process.env) {
  return path.join(stateDirectory(env), "state.json");
}

export function serverLogFile(env = process.env) {
  return path.join(stateDirectory(env), "server.log");
}

export function serverBaseUrl(env = process.env) {
  return `http://127.0.0.1:${reviewPort(env)}`;
}
