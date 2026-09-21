import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

export function resolveWorkLogDirectory(environment = process.env) {
  const configured = environment.WORK_LOG_DIR?.trim();
  const fallbackRoot = environment.XDG_DATA_HOME?.trim() || path.join(homedir(), ".local", "share");
  const directory = configured || path.join(fallbackRoot, "work-log");
  if (!path.isAbsolute(directory)) throw new Error("WORK_LOG_DIR must be an absolute path.");
  return path.resolve(directory);
}

export function findCheckpoint(directory, checkpointId) {
  if (!/^cp_[0-9a-f-]{36}$/.test(checkpointId)) throw new Error("checkpoint identifier is invalid.");
  const eventsRoot = path.join(directory, "events");
  if (!existsSync(eventsRoot)) throw new Error(`Checkpoint not found: ${checkpointId}.`);
  const pending = [eventsRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(entryPath);
      if (entry.isFile() && entry.name === `${checkpointId}.json`) {
        return { checkpoint: JSON.parse(readFileSync(entryPath, "utf8")), path: entryPath };
      }
    }
  }
  throw new Error(`Checkpoint not found: ${checkpointId}.`);
}

export function purgeCheckpoint(directory, checkpointId) {
  const located = findCheckpoint(directory, checkpointId);
  unlinkSync(located.path);
  return located.checkpoint;
}

export function writeCheckpoint(directory, checkpoint) {
  const instant = new Date(checkpoint.occurred_at);
  const eventDirectory = path.join(
    directory,
    "events",
    String(instant.getUTCFullYear()),
    String(instant.getUTCMonth() + 1).padStart(2, "0"),
  );
  mkdirSync(eventDirectory, { recursive: true, mode: 0o700 });
  const outputPath = path.join(eventDirectory, `${checkpoint.checkpoint_id}.json`);
  const temporaryPath = path.join(eventDirectory, `.${checkpoint.checkpoint_id}.${process.pid}.tmp`);
  writeFileSync(temporaryPath, `${JSON.stringify(checkpoint, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  renameSync(temporaryPath, outputPath);
  return outputPath;
}
