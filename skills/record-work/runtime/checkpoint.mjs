import crypto from "node:crypto";

const ACTION_STATES = Object.freeze({
  plan: "planned",
  start: "active",
  pause: "paused",
  complete: "completed",
  abandon: "abandoned",
});
const TERMINAL_STATES = new Set(["completed", "abandoned"]);
const STATE_ACTIONS = Object.freeze({
  planned: "plan",
  active: "start",
  paused: "pause",
  completed: "complete",
  abandoned: "abandon",
});
const MAX_TEXT_LENGTH = 8_000;
const MAX_ARRAY_LENGTH = 100;
const CHECKPOINT_FIELDS = new Set([
  "action", "title", "summary", "work_item_id", "parent_work_item_id",
  "follows_work_item_id", "decisions", "blockers", "next_action", "files",
  "commits", "tickets", "due_at",
]);
const SECRET_PATTERN = /(?:password|passwd|secret|token|api[_-]?key|authorization)\s*[:=]\s*\S+/i;

function text(value, field, { required = false } = {}) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    throw new Error(`${field} must be a string.`);
  }
  const normalized = typeof value === "string" ? value.trim() : "";
  if (required && !normalized) throw new Error(`${field} is required.`);
  if (normalized.length > MAX_TEXT_LENGTH) throw new Error(`${field} is too long.`);
  if (field === "title" && /[\r\n]/.test(normalized)) throw new Error("title must be one line.");
  if (SECRET_PATTERN.test(normalized)) throw new Error(`${field} appears to contain a secret.`);
  return normalized;
}

function stringArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`${field} must be an array of strings.`);
  }
  if (value.length > MAX_ARRAY_LENGTH) throw new Error(`${field} has too many entries.`);
  return value.map((entry) => text(entry, field)).filter(Boolean);
}

function optionalIdentifier(value, field) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)) {
    throw new Error(`${field} is invalid.`);
  }
  return value;
}

function optionalInstant(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const isoInstant = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof value !== "string" || !isoInstant.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO 8601 timestamp.`);
  }
  return new Date(value).toISOString();
}

function sessionMetadata(environment) {
  if (environment.PI_SESSION_ID) return { harness: "pi", sessionId: environment.PI_SESSION_ID };
  if (environment.CLAUDE_CODE_SESSION_ID) {
    return { harness: "claude-code", sessionId: environment.CLAUDE_CODE_SESSION_ID };
  }
  return { harness: "manual", sessionId: "manual" };
}

export function buildCheckpoint(input, repository, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Input must be one JSON object.");
  }
  const unknownField = Object.keys(input).find((field) => !CHECKPOINT_FIELDS.has(field));
  if (unknownField) throw new Error(`Unsupported checkpoint field: ${unknownField}.`);
  const action = text(input.action, "action", { required: true });
  const state = ACTION_STATES[action] ?? (action === "checkpoint" ? null : undefined);
  if (state === undefined) throw new Error(`Unsupported action: ${action}.`);
  const existingWorkItemId = optionalIdentifier(input.work_item_id, "work_item_id");
  if (!existingWorkItemId && !["plan", "start"].includes(action)) {
    throw new Error(`work_item_id is required for ${action}.`);
  }
  const title = text(input.title, "title", { required: !existingWorkItemId });
  const summary = text(input.summary, "summary", { required: true });
  const session = sessionMetadata(options.environment ?? process.env);
  const checkpointId = `cp_${crypto.randomUUID()}`;
  const workItemId = existingWorkItemId ?? `work_${crypto.randomUUID()}`;
  const occurredAt = (options.now ?? new Date()).toISOString();
  return {
    schema_version: 1,
    checkpoint_id: checkpointId,
    work_item_id: workItemId,
    parent_work_item_id: optionalIdentifier(input.parent_work_item_id, "parent_work_item_id"),
    follows_work_item_id: optionalIdentifier(input.follows_work_item_id, "follows_work_item_id"),
    corrects_checkpoint_id: null,
    occurred_at: occurredAt,
    recorded_at: occurredAt,
    event_type: state ? "lifecycle" : "progress",
    state,
    title,
    summary,
    decisions: stringArray(input.decisions, "decisions"),
    blockers: stringArray(input.blockers, "blockers"),
    next_action: text(input.next_action, "next_action"),
    files: stringArray(input.files, "files"),
    commits: stringArray(input.commits, "commits"),
    tickets: stringArray(input.tickets, "tickets"),
    due_at: optionalInstant(input.due_at, "due_at"),
    repository_id: repository.id,
    repository_origin: repository.origin,
    branch: repository.branch,
    harness: session.harness,
    session_id: session.sessionId,
    terminal: TERMINAL_STATES.has(state),
  };
}

export function buildCorrection(original, patch, options = {}) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new Error("Correction input must be one JSON object.");
  }
  const allowedFields = new Set([
    "title", "summary", "decisions", "blockers", "next_action", "files",
    "commits", "tickets", "due_at", "parent_work_item_id", "follows_work_item_id",
  ]);
  for (const field of Object.keys(patch)) {
    if (!allowedFields.has(field)) throw new Error(`Correction field is not supported: ${field}.`);
  }
  const action = original.state ? STATE_ACTIONS[original.state] : "checkpoint";
  const retained = Object.fromEntries(
    [...CHECKPOINT_FIELDS]
      .filter((field) => field !== "action" && original[field] !== undefined)
      .map((field) => [field, original[field]]),
  );
  const corrected = buildCheckpoint({
    ...retained,
    ...patch,
    action,
    work_item_id: original.work_item_id,
  }, {
    id: original.repository_id,
    origin: original.repository_origin,
    branch: original.branch,
  }, options);
  return {
    ...corrected,
    occurred_at: original.occurred_at,
    recorded_at: corrected.occurred_at,
    event_type: "correction",
    corrects_checkpoint_id: original.checkpoint_id,
  };
}
