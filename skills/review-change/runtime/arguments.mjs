const VALUE_OPTIONS = new Map([
  ["--intent", "intent"],
  ["--provider", "provider"],
  ["--model", "model"],
  ["--thinking", "thinking"],
]);
const MAX_OPTION_LENGTH = 256;
const MAX_TARGET_LENGTH = 2_048;
const MAX_INTENT_LENGTH = 20_000;

export function parseArguments(argv) {
  const parsed = { target: null, intent: null, piOptions: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("-")) {
      index = consumeOption(argv, index, parsed);
      continue;
    }
    if (parsed.target !== null) throw usageError("Only one review target may be provided");
    parsed.target = validateValue("target", argument, MAX_TARGET_LENGTH);
  }
  validatePiSelection(parsed.piOptions);
  return parsed;
}

function validatePiSelection(piOptions) {
  if (piOptions.includes("--provider") && !piOptions.includes("--model")) {
    throw usageError("--provider requires --model so mandatory subagents use the same backend");
  }
}

function consumeOption(argv, index, parsed) {
  const option = argv[index];
  const optionName = VALUE_OPTIONS.get(option);
  if (!optionName) throw usageError(`Unknown option: ${option}`);
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw usageError(`${option} requires a value`);
  if (optionName === "intent") {
    parsed.intent = validateValue("intent", value, MAX_INTENT_LENGTH);
  } else {
    parsed.piOptions.push(option, validateValue(optionName, value, MAX_OPTION_LENGTH));
  }
  return index + 1;
}

function validateValue(name, value, maximumLength) {
  if (!value || value.includes("\0") || /[\r\n]/.test(value)) {
    throw usageError(`${name} must be one non-empty line`);
  }
  if (value.length > maximumLength) throw usageError(`${name} is too long`);
  return value;
}

function usageError(message) {
  return Object.assign(new Error(message), { code: "USAGE_ERROR" });
}
