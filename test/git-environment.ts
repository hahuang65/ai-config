import { isolatedGitEnvironment } from "../scripts/test-suite-runner.mjs";

export const ISOLATED_GIT_ENV = Object.freeze(isolatedGitEnvironment());

export function isolateTestGitConfiguration() {
  for (const variable of Object.keys(process.env)) {
    if (variable.startsWith("GIT_")) delete process.env[variable];
  }
  Object.assign(process.env, ISOLATED_GIT_ENV);
}
