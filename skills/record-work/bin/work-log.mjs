#!/usr/bin/env node

import { buildCheckpoint, buildCorrection } from "../runtime/checkpoint.mjs";
import { openWork, openWorkPage, periodWork, timeline, workItem, workItemHistory } from "../runtime/query.mjs";
import { clearReconciliation } from "../runtime/reconciliation.mjs";
import { renderPeriodSummary, renderSessionDigest } from "../../summarize-work/runtime/render.mjs";
import { resolveRepository } from "../runtime/repository.mjs";
import {
  findCheckpoint,
  purgeCheckpoint,
  resolveWorkLogDirectory,
  writeCheckpoint,
} from "../runtime/storage.mjs";

class UsageError extends Error {}

const MAX_INPUT_BYTES = 64 * 1024;
const HELP = `Usage: work-log <command>

Commands:
  record       Read one checkpoint request as JSON from stdin
  correct      Append a corrected replacement for one checkpoint
  purge        Physically remove one sensitive checkpoint after confirmation
  open         Show the unordered collection of Open work
  digest       Show compact Open work context for the current repository
  summary      Render a period summary; requires --from and --to dates
  item         Show one work item's current state and durations
  history      Show one work item's checkpoints
  timeline     Show chronological checkpoints; requires --from and --to dates
  help         Show this help

Collection options:
  --limit N    Return 1 through 1000 items (default: 100)
  --all        Return the complete collection instead of the bounded default
  --json       Emit deterministic JSON for supported read commands

Examples:
  printf '%s' '{"action":"plan","title":"Improve installer","summary":"Retain for later."}' | work-log record
  work-log open --json
  work-log summary --from 2026-09-01 --to 2026-09-18
  work-log history work_<id> --json
`;

function validateOptions(command, argumentsList, optionsWithValues, allowedFlags = []) {
  const allowed = new Set([...optionsWithValues, ...allowedFlags]);
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (!argument.startsWith("--")) continue;
    if (!allowed.has(argument)) throw new UsageError(`Unknown option for ${command}: ${argument}.`);
    if (optionsWithValues.includes(argument)) {
      if (!argumentsList[index + 1] || argumentsList[index + 1].startsWith("--")) {
        throw new UsageError(`${argument} requires a value.`);
      }
      index += 1;
    }
  }
}

function positionalArguments(argumentsList, optionsWithValues = []) {
  const positionals = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (optionsWithValues.includes(argument)) {
      index += 1;
      continue;
    }
    if (!argument.startsWith("--")) positionals.push(argument);
  }
  return positionals;
}

function validateInvocation(command, argumentsList) {
  if (["record", "digest"].includes(command) && argumentsList.length !== 0) {
    throw new UsageError(`${command} does not accept arguments.`);
  }
  if (command === "open") {
    validateOptions(command, argumentsList, ["--limit"], ["--all", "--json"]);
    if (positionalArguments(argumentsList, ["--limit"]).length > 0) {
      throw new UsageError("open accepts options only.");
    }
    return;
  }
  if (["item", "history"].includes(command)) {
    validateOptions(
      command,
      argumentsList,
      command === "history" ? ["--limit"] : [],
      command === "history" ? ["--all", "--json"] : ["--json"],
    );
    if (!argumentsList[0] || argumentsList[0].startsWith("--")) {
      throw new UsageError(`${command} requires the work-item identifier first.`);
    }
    const positionals = positionalArguments(argumentsList, command === "history" ? ["--limit"] : []);
    if (positionals.length === 0) throw new UsageError(`${command} requires a work-item identifier.`);
    if (positionals.length !== 1) throw new UsageError(`${command} accepts one work-item identifier.`);
    return;
  }
  if (command === "correct") {
    if (argumentsList.length !== 1 || argumentsList[0].startsWith("--")) {
      throw new UsageError("correct requires one checkpoint identifier.");
    }
    return;
  }
  if (command === "purge") {
    validateOptions(command, argumentsList, [], ["--confirm-sensitive-purge"]);
    if (argumentsList.length !== 2 || argumentsList[0].startsWith("--")) {
      throw new UsageError("purge requires the checkpoint identifier first and confirmation second.");
    }
    return;
  }
  if (["summary", "timeline"].includes(command)) {
    validateOptions(
      command,
      argumentsList,
      ["--from", "--to", "--limit"],
      command === "timeline" ? ["--all", "--json"] : ["--all"],
    );
    if (positionalArguments(argumentsList, ["--from", "--to", "--limit"]).length > 0) {
      throw new UsageError(`${command} accepts options only.`);
    }
    return;
  }
}

async function readStandardInput() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (Buffer.byteLength(input) > MAX_INPUT_BYTES) {
      throw new UsageError(`JSON input exceeds ${MAX_INPUT_BYTES} bytes.`);
    }
  }
  if (!input.trim()) throw new Error("record requires one JSON object on stdin.");
  try {
    return JSON.parse(input);
  } catch {
    throw new Error("record input must be valid JSON.");
  }
}

function configuredNow(environment) {
  if (!environment.WORK_LOG_NOW) return new Date();
  const instant = new Date(environment.WORK_LOG_NOW);
  if (Number.isNaN(instant.valueOf())) throw new Error("WORK_LOG_NOW must be an ISO 8601 timestamp.");
  return instant;
}

const ALLOWED_PREVIOUS_STATES = Object.freeze({
  start: new Set(["planned", "paused"]),
  pause: new Set(["active"]),
  complete: new Set(["active", "paused"]),
  abandon: new Set(["planned", "active", "paused"]),
  checkpoint: new Set(["planned", "active", "paused"]),
});

function validateTransition(input, current) {
  if (!current) return;
  const allowed = ALLOWED_PREVIOUS_STATES[input.action];
  if (!allowed?.has(current.state)) {
    throw new Error(`Action ${input.action} cannot follow state ${current.state}.`);
  }
}

function validateRelationships(checkpoint, directory, repositoryId) {
  for (const field of ["parent_work_item_id", "follows_work_item_id"]) {
    if (!checkpoint[field]) continue;
    if (checkpoint[field] === checkpoint.work_item_id) {
      throw new Error(`A work item cannot relate to itself through ${field}.`);
    }
    const related = workItem(directory, checkpoint[field]);
    if (!related) throw new Error(`Related work item not found: ${checkpoint[field]}.`);
    if (related.repository_id !== repositoryId) {
      throw new Error(`Related work item ${checkpoint[field]} belongs to another repository.`);
    }
    if (field === "follows_work_item_id" && !["completed", "abandoned"].includes(related.state)) {
      throw new Error(`Follow-up source ${checkpoint[field]} is not terminal.`);
    }
    if (field === "parent_work_item_id") {
      const visited = new Set([related.work_item_id]);
      let ancestor = related;
      while (ancestor.parent_work_item_id) {
        if (ancestor.parent_work_item_id === checkpoint.work_item_id) {
          throw new Error("A parent relationship cannot create a cycle.");
        }
        if (visited.has(ancestor.parent_work_item_id)) break;
        visited.add(ancestor.parent_work_item_id);
        ancestor = workItem(directory, ancestor.parent_work_item_id);
        if (!ancestor) break;
      }
    }
  }
}

async function record(environment) {
  const directory = resolveWorkLogDirectory(environment);
  const input = await readStandardInput();
  const checkpointDraft = buildCheckpoint(input, { id: "", origin: "", branch: "" }, {
    environment,
    now: configuredNow(environment),
  });
  let current;
  if (input.work_item_id) {
    current = workItem(directory, input.work_item_id);
    if (!current) throw new Error(`Work item not found: ${input.work_item_id}.`);
    if (["completed", "abandoned"].includes(current.state)) {
      throw new Error(`Work item ${input.work_item_id} is terminal; create a linked follow-up instead.`);
    }
    validateTransition(input, current);
  }
  const repository = resolveRepository(process.cwd(), directory);
  if (current && current.repository_id !== repository.id) {
    throw new Error(`Work item ${input.work_item_id} belongs to repository ${current.repository_id}.`);
  }
  const checkpoint = {
    ...checkpointDraft,
    repository_id: repository.id,
    repository_origin: repository.origin,
    branch: repository.branch,
  };
  validateRelationships(checkpoint, directory, repository.id);
  const outputPath = writeCheckpoint(directory, checkpoint);
  clearReconciliation(directory, checkpoint.session_id, checkpoint.checkpoint_id);
  process.stdout.write(`${JSON.stringify({
    checkpoint_id: checkpoint.checkpoint_id,
    work_item_id: checkpoint.work_item_id,
    path: outputPath,
  })}\n`);
}

async function correct(environment) {
  const directory = resolveWorkLogDirectory(environment);
  const original = findCheckpoint(directory, process.argv[3] ?? "").checkpoint;
  const checkpoint = buildCorrection(original, await readStandardInput(), {
    environment,
    now: configuredNow(environment),
  });
  resolveRepository(process.cwd(), directory);
  validateRelationships(checkpoint, directory, checkpoint.repository_id);
  const outputPath = writeCheckpoint(directory, checkpoint);
  clearReconciliation(directory, checkpoint.session_id, checkpoint.checkpoint_id);
  process.stdout.write(`${JSON.stringify({
    checkpoint_id: checkpoint.checkpoint_id,
    work_item_id: checkpoint.work_item_id,
    path: outputPath,
  })}\n`);
}

function purge(environment) {
  if (!process.argv.includes("--confirm-sensitive-purge")) {
    throw new Error("purge requires --confirm-sensitive-purge.");
  }
  const directory = resolveWorkLogDirectory(environment);
  resolveRepository(process.cwd(), directory);
  const purged = purgeCheckpoint(directory, process.argv[3] ?? "");
  process.stdout.write(`${JSON.stringify({ purged_checkpoint_id: purged.checkpoint_id })}\n`);
}

function collectionLimit() {
  const allCount = process.argv.filter((argument) => argument === "--all").length;
  const limitCount = process.argv.filter((argument) => argument === "--limit").length;
  if (allCount > 1 || limitCount > 1) throw new UsageError("Collection options cannot be repeated.");
  const all = allCount === 1;
  const index = process.argv.indexOf("--limit");
  if (all && index >= 0) throw new UsageError("Use either --all or --limit, not both.");
  if (all) return undefined;
  if (index < 0) return 100;
  const value = Number(process.argv[index + 1]);
  if (!Number.isInteger(value) || value < 1 || value > 1_000) {
    throw new UsageError("--limit must be an integer from 1 through 1000.");
  }
  return value;
}

function dateArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.valueOf())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new UsageError(`${name} requires a valid YYYY-MM-DD date.`);
  }
  return value;
}

function summary(environment) {
  const directory = resolveWorkLogDirectory(environment);
  const from = dateArgument("--from");
  const to = dateArgument("--to");
  if (from > to) throw new UsageError("--from must not be after --to.");
  const limit = collectionLimit();
  process.stdout.write(renderPeriodSummary(
    periodWork(directory, from, to, limit),
    openWorkPage(directory, limit),
    from,
    to,
  ));
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, process.argv.includes("--json") ? 0 : 2)}\n`);
}

function showOpen(environment) {
  writeJson(openWorkPage(resolveWorkLogDirectory(environment), collectionLimit()));
}

function showDigest(environment) {
  const directory = resolveWorkLogDirectory(environment);
  const repository = resolveRepository(process.cwd(), directory);
  process.stdout.write(renderSessionDigest(openWork(directory, 1_000), repository.id, configuredNow(environment)));
}

function showItem(environment) {
  const identifier = process.argv[3] ?? "";
  const current = workItem(resolveWorkLogDirectory(environment), identifier);
  if (!current) throw new Error(`Work item not found: ${identifier}.`);
  writeJson(current);
}

function showHistory(environment) {
  writeJson(workItemHistory(
    resolveWorkLogDirectory(environment),
    process.argv[3] ?? "",
    collectionLimit(),
  ));
}

function showTimeline(environment) {
  const from = dateArgument("--from");
  const to = dateArgument("--to");
  if (from > to) throw new UsageError("--from must not be after --to.");
  writeJson(timeline(resolveWorkLogDirectory(environment), from, to, collectionLimit()));
}

async function main() {
  const command = process.argv[2] ?? "help";
  if (["help", "--help", "-h"].includes(command)) return process.stdout.write(HELP);
  const commands = new Set(["record", "correct", "purge", "open", "digest", "summary", "item", "history", "timeline"]);
  if (!commands.has(command)) throw new UsageError(`Unknown command: ${command}. Run work-log help.`);
  validateInvocation(command, process.argv.slice(3));
  if (command === "record") return record(process.env);
  if (command === "correct") return correct(process.env);
  if (command === "purge") return purge(process.env);
  if (command === "open") return showOpen(process.env);
  if (command === "digest") return showDigest(process.env);
  if (command === "summary") return summary(process.env);
  if (command === "item") return showItem(process.env);
  if (command === "history") return showHistory(process.env);
  if (command === "timeline") return showTimeline(process.env);
}

main().catch((error) => {
  process.stderr.write(`work-log: ${error.message}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
