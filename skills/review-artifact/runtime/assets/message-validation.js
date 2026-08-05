"use strict";

const LIMITS = Object.freeze({
  chatEntries: 500,
  displayText: 2_000,
  prompt: 10_000,
  queueBytes: 120_000,
  queuePrompts: 100,
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
    const prompt = validatePrompt(message.prompt);
    if (!prompt) return null;
    if (message.type === "review:submit") {
      return {
        type: message.type,
        prompt: { ...prompt, displayText: prompt.text.trim() || "Form submitted" },
      };
    }
    return { type: message.type, prompt };
  }
  if (message.type === "review:snapshot") {
    const snapshot = boundedString(message.snapshot, LIMITS.snapshot);
    return snapshot === null ? null : { type: message.type, snapshot };
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
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
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
  validateStoredQueue,
});
