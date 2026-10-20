export const COMMIT_LOG_EARLIER_TASKS = 20;
export const COMMIT_LOG_COMMAND_GUARD_MS = 10_000;
// Git init, the final start, two list calls, and the commit call.
export const COMMIT_LOG_COMMAND_COUNT = COMMIT_LOG_EARLIER_TASKS + 5;
export const COMMIT_LOG_SCENARIO_GUARD_MS = (COMMIT_LOG_COMMAND_COUNT + 1) * COMMIT_LOG_COMMAND_GUARD_MS;
