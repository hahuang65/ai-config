"use strict";

const LIMITS = Object.freeze({
  chatEntries: 500,
  displayText: 2_000,
  prompt: 10_000,
  queueBytes: 120_000,
  queuePrompts: 100,
  revisionElements: 2_500,
  revisionFields: 50,
  revisionRegions: 50,
  revisionSnapshot: 2_000_000,
  selector: 2_000,
  snapshot: 100_000,
  tag: 100,
  text: 2_000,
  targetOffset: 10_000_000,
  targetPath: 32,
  warnings: 50,
});

export function validateFrameMessage(message) {
  if (!plainObject(message) || typeof message.type !== "string") return null;
  if (message.type === "review:ready") {
    const title = boundedString(message.title ?? "", LIMITS.displayText);
    return { type: message.type, ...(title === null ? {} : { title }) };
  }
  if (message.type === "review:queue" || message.type === "review:submit") {
    const prompt = validatePrompt(framePrompt(message));
    if (!prompt) return null;
    if (message.type === "review:submit") {
      const completion = message.completion === undefined ? "end" : message.completion;
      if (!new Set(["approve", "end"]).has(completion)) return null;
      return {
        type: message.type,
        completion,
        prompt: { ...prompt, displayText: prompt.text.trim() || "Form submitted" },
      };
    }
    return { type: message.type, prompt };
  }
  if (message.type === "review:snapshot") {
    const snapshot = boundedString(message.snapshot, LIMITS.snapshot);
    return snapshot === null ? null : { type: message.type, snapshot };
  }
  if (message.type === "review:artifact-revision") {
    const revision = validateArtifactRevision(message.revision);
    const generation = boundedIdentifier(message.generation);
    return revision && generation !== null ? { type: message.type, generation, revision } : null;
  }
  if (message.type === "review:artifact-revision-failed") {
    const generation = boundedIdentifier(message.generation);
    const status = new Set(["limited", "unavailable"]).has(message.status) ? message.status : null;
    return generation !== null && status ? { type: message.type, generation, status } : null;
  }
  if (message.type === "review:change-presentation-failed") {
    const identifiers = validateComparisonIdentifiers(message);
    return identifiers ? { type: message.type, ...identifiers } : null;
  }
  if (message.type === "review:layout") {
    const layoutWarnings = validateLayoutWarnings(message.layoutWarnings);
    return layoutWarnings ? { type: message.type, layoutWarnings } : null;
  }
  if (message.type === "review:locate-result" && typeof message.ok === "boolean") {
    return { type: message.type, ok: message.ok };
  }
  if (message.type === "review:scroll") {
    const x = scrollCoordinate(message.x);
    const y = scrollCoordinate(message.y);
    return x === null || y === null ? null : { type: message.type, x, y };
  }
  return null;
}

function framePrompt(message) {
  if (plainObject(message.prompt)) return message.prompt;
  if (message.type !== "review:submit") return message.prompt;
  return {
    prompt: message.prompt,
    selector: message.selector,
    tag: message.tag,
    text: message.text,
    displayText: message.displayText,
    target: message.target,
  };
}

export function validateShellMessage(message) {
  if (!plainObject(message) || typeof message.type !== "string") return null;
  const identifiers = validateComparisonIdentifiers(message);
  if (!identifiers) return null;
  if (message.type === "review:activate-changed-region"
    && new Set(["next", "previous"]).has(message.direction)) {
    return { type: message.type, ...identifiers, direction: message.direction };
  }
  if (message.type === "review:dismiss-changed-regions") return { type: message.type, ...identifiers };
  if (message.type !== "review:present-changed-regions") return null;
  if (!Array.isArray(message.regions) || message.regions.length > LIMITS.revisionRegions) return null;
  const regions = message.regions.map(validateChangedRegion);
  return regions.every(Boolean) ? { type: message.type, ...identifiers, regions } : null;
}

export function validateStoredQueue(queue) {
  if (!Array.isArray(queue)) return [];
  let validatedQueue = [];
  for (const entry of queue) {
    const nextQueue = appendPrompt(validatedQueue, entry);
    if (nextQueue) validatedQueue = nextQueue;
  }
  return validatedQueue;
}

export function appendPrompt(queue, prompt) {
  if (!Array.isArray(queue) || queue.length >= LIMITS.queuePrompts) return null;
  const validatedPrompt = validatePrompt(prompt);
  if (!validatedPrompt) return null;
  const candidate = [...queue, validatedPrompt];
  return serializedBytes(candidate) <= LIMITS.queueBytes ? candidate : null;
}

export function validatePrompt(prompt) {
  if (!plainObject(prompt)) return null;
  const text = boundedString(prompt.prompt, LIMITS.prompt);
  const selector = boundedString(prompt.selector ?? "", LIMITS.selector);
  const tag = boundedString(prompt.tag ?? "", LIMITS.tag);
  const context = boundedString(prompt.text ?? "", LIMITS.text);
  const displayText = prompt.displayText === undefined
    ? undefined
    : boundedString(prompt.displayText, LIMITS.displayText);
  if (!text?.trim() || selector === null || tag === null || context === null || displayText === null) return null;
  const target = prompt.target === undefined ? undefined : validateTextTarget(prompt.target);
  if (prompt.target !== undefined && !target) return null;
  return {
    prompt: text,
    selector,
    tag,
    text: context,
    ...(displayText === undefined ? {} : { displayText }),
    ...(target ? { target } : {}),
  };
}

export function validateChatEntries(chat) {
  if (!Array.isArray(chat)) return [];
  return chat.slice(-LIMITS.chatEntries).map(validateChatEntry).filter(Boolean);
}

function validateChatEntry(entry) {
  if (!plainObject(entry) || !new Set(["agent", "user"]).has(entry.role)) return null;
  const text = boundedString(entry.text, LIMITS.prompt);
  const at = boundedString(entry.at ?? "", LIMITS.tag);
  if (text === null || at === null) return null;
  const timestamp = at ? { at } : {};
  if (entry.role === "agent" || entry.prompt === undefined) return { role: entry.role, text, ...timestamp };
  if (!plainObject(entry.prompt)) return null;
  const prompt = validatePrompt({ ...entry.prompt, prompt: text });
  if (!prompt) return null;
  const { prompt: _feedback, ...metadata } = prompt;
  return { role: "user", text, prompt: metadata, ...timestamp };
}

function validateComparisonIdentifiers(message) {
  const comparisonId = boundedIdentifier(message.comparisonId);
  const generation = boundedIdentifier(message.generation);
  return comparisonId === null || generation === null ? null : { comparisonId, generation };
}

function boundedIdentifier(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= LIMITS.targetOffset ? value : null;
}

function validateArtifactRevision(revision) {
  if (!plainObject(revision) || revision.version !== 1 || !Array.isArray(revision.elements)) return null;
  if (revision.elements.length > LIMITS.revisionElements || serializedBytes(revision) > LIMITS.revisionSnapshot) return null;
  const elements = revision.elements.map(validateRevisionElement);
  return elements.every(Boolean) ? { version: 1, elements } : null;
}

function validateRevisionElement(element) {
  if (!plainObject(element)) return null;
  const path = validateElementPath(element.path);
  const tag = boundedString(element.tag, LIMITS.tag);
  const directText = boundedString(element.directText, LIMITS.text);
  const identity = validateOptionalIdentity(element.identity);
  const attributes = validateOptionalStringRecord(element.attributes);
  const computedStyles = validateOptionalStringRecord(element.computedStyles);
  if (!path || tag === null || directText === null || identity === null
    || attributes === null || computedStyles === null) return null;
  return {
    path,
    tag,
    directText,
    ...(identity === undefined ? {} : { identity }),
    ...(attributes === undefined ? {} : { attributes }),
    ...(computedStyles === undefined ? {} : { computedStyles }),
  };
}

function validateOptionalIdentity(identity) {
  if (identity === undefined) return undefined;
  if (!plainObject(identity)) return null;
  const allowed = new Set(["id", "sliceId", "criterionId"]);
  if (Object.keys(identity).some((key) => !allowed.has(key))) return null;
  const entries = Object.entries(identity).map(([key, value]) => [key, boundedString(value, LIMITS.selector)]);
  return entries.every(([, value]) => value !== null) ? Object.fromEntries(entries) : null;
}

function validateOptionalStringRecord(record) {
  if (record === undefined) return undefined;
  if (!plainObject(record)) return null;
  const entries = Object.entries(record);
  if (entries.length > LIMITS.revisionFields) return null;
  const boundedEntries = entries.map(([key, value]) => [boundedString(key, LIMITS.tag), boundedString(value, LIMITS.text)]);
  return boundedEntries.every(([key, value]) => key !== null && value !== null)
    ? Object.fromEntries(boundedEntries)
    : null;
}

function validateChangedRegion(region) {
  if (!plainObject(region)
    || !new Set(["added", "moved", "removed", "updated", "updated-moved"]).has(region.kind)) return null;
  const path = validateElementPath(region.path);
  return path ? { kind: region.kind, path } : null;
}

function validateElementPath(candidate) {
  if (!Array.isArray(candidate) || candidate.length > LIMITS.targetPath) return null;
  return candidate.every((entry) => Number.isSafeInteger(entry) && entry >= 0) ? [...candidate] : null;
}

function validateTextTarget(target) {
  if (!plainObject(target) || target.type !== "text-range") return null;
  const text = boundedString(target.text, LIMITS.text);
  const selector = boundedString(target.selector, LIMITS.selector);
  const start = validateBoundary(target.start);
  const end = validateBoundary(target.end);
  if (text === null || selector === null || !start || !end) return null;
  return { type: "text-range", text, selector, start, end };
}

function validateBoundary(boundary) {
  if (!plainObject(boundary) || !Array.isArray(boundary.path)) return null;
  const selector = boundedString(boundary.selector, LIMITS.selector);
  const path = boundary.path.slice(0, LIMITS.targetPath);
  if (selector === null || path.length !== boundary.path.length) return null;
  if (!path.every((entry) => Number.isSafeInteger(entry) && entry >= 0)) return null;
  if (!Number.isSafeInteger(boundary.offset)
    || boundary.offset < 0
    || boundary.offset > LIMITS.targetOffset) return null;
  return { selector, path, offset: boundary.offset };
}

function validateLayoutWarnings(warnings) {
  if (!Array.isArray(warnings) || warnings.length > LIMITS.warnings) return null;
  const validated = warnings.map(validateLayoutWarning);
  return validated.every(Boolean) ? validated : null;
}

function validateLayoutWarning(warning) {
  if (!plainObject(warning) || warning.severity !== "error") return null;
  const selector = boundedString(warning.selector, LIMITS.selector);
  const kind = boundedString(warning.kind, LIMITS.tag);
  if (selector === null || kind === null) return null;
  const axis = new Set(["horizontal", "vertical"]).has(warning.axis) ? warning.axis : undefined;
  return {
    selector,
    kind,
    ...(axis ? { axis } : {}),
    overflowPx: finiteNumber(warning.overflowPx),
    viewportWidth: finiteNumber(warning.viewportWidth),
    severity: "error",
  };
}

function serializedBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundedString(value, maximum) {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function scrollCoordinate(value) {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= LIMITS.targetOffset
    ? value
    : null;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function plainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

globalThis.ReviewArtifactMessages = Object.freeze({
  appendPrompt,
  validateChatEntries,
  validateFrameMessage,
  validatePrompt,
  validateShellMessage,
  validateStoredQueue,
});
