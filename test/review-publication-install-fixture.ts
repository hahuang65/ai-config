import { writeFile } from "node:fs/promises";
import path from "node:path";

const PRIVATE_EXECUTABLE_MODE = 0o700;
const AVAILABLE_PORT_CHECK_NAME = "review-publication-port-available";

export type FixtureServicePlatform = "Darwin" | "Linux" | "Plan9";

interface IsolatedInstallerEnvironmentOptions {
  home: string;
  repositoryRoot: string;
  platform: FixtureServicePlatform;
  serviceEnable?: "false" | "true";
  nodeExecutable?: string;
  githubExecutable?: string;
  confirmationExecutable?: string;
  additionalEnvironment?: Record<string, string>;
}

export async function isolatedInstallerEnvironment({
  home,
  repositoryRoot,
  platform,
  serviceEnable = "false",
  nodeExecutable = process.execPath,
  githubExecutable = process.execPath,
  confirmationExecutable = process.execPath,
  additionalEnvironment = {},
}: IsolatedInstallerEnvironmentOptions) {
  const configuredPortCheck = additionalEnvironment.AI_CONFIG_PORT_CHECK_BIN;
  const portCheck = configuredPortCheck ?? await writeAvailablePortCheck(home);
  return {
    ...process.env,
    HOME: home,
    AI_CONFIG_REPO_DIR: repositoryRoot,
    AI_CONFIG_SERVICE_ENABLE: serviceEnable,
    AI_CONFIG_SERVICE_PLATFORM: platform,
    AI_CONFIG_NODE_BIN: nodeExecutable,
    AI_CONFIG_GH_BIN: githubExecutable,
    AI_CONFIG_CONFIRMATION_BIN: confirmationExecutable,
    ...additionalEnvironment,
    AI_CONFIG_PORT_CHECK_BIN: portCheck,
  };
}

async function writeAvailablePortCheck(home: string) {
  const executable = path.join(home, AVAILABLE_PORT_CHECK_NAME);
  await writeFile(executable, `#!${process.execPath}\nprocess.exit(0);\n`, { mode: PRIVATE_EXECUTABLE_MODE });
  return executable;
}
