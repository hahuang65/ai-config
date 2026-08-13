import { REVIEW_MODES, REVIEW_PURPOSES } from "./protocol.mjs";

const REVIEW_PURPOSE_SET = new Set(REVIEW_PURPOSES);
const REVIEW_MODE_SET = new Set(REVIEW_MODES);

const REVIEW_COMMAND_SCHEMA = deepFreeze({
  top: {
    shorthandUsage: "review-artifact <html-file> [--no-open] [--reopen] [--purpose <purpose>] [--mode <mode>]",
    defaults: [
      "  open launches the browser unless --no-open is passed.",
      "  purpose defaults to feedback.",
      "  mode defaults from purpose: decision uses explore; other purposes use annotate.",
    ],
    example: "review-artifact docs/features/example/specs.html",
  },
  commands: {
    open: {
      booleanOptions: {
        "--no-open": {
          default: false,
          help: "  --no-open           Create the session without launching a browser",
        },
        "--reopen": {
          default: false,
          help: "  --reopen            Start a new review after a prior review ended",
        },
      },
      valueOptions: {
        "--purpose": {
          default: "feedback",
          duplicateError: "--purpose may be provided only once",
          missingError: "Review purpose is required after --purpose",
          validate: (value) => REVIEW_PURPOSE_SET.has(value),
          invalidError: (value) => `Unknown review purpose: ${value}`,
          help: "  --purpose <purpose> Select feedback, approval, or decision",
        },
        "--mode": {
          default: null,
          duplicateError: "--mode may be provided only once",
          missingError: "Initial mode is required after --mode",
          validate: (value) => REVIEW_MODE_SET.has(value),
          invalidError: (value) => `Unknown initial mode: ${value}`,
          help: "  --mode <mode>       Start in annotate or explore mode",
        },
      },
      positionalCount: 1,
      positionalError: "open accepts exactly one HTML file",
      help: {
        usage: "review-artifact open <html-file> [--no-open] [--reopen] [--purpose <purpose>] [--mode <mode>]",
        summary: "Open or resume an HTML review; a direct <html-file> is shorthand for open.",
        description: "Open or resume an HTML review.",
        arguments: ["  html-file  Existing .html or .htm artifact"],
        defaults: [
          "  The browser opens unless --no-open is passed.",
          "  Purpose defaults to feedback.",
          "  Mode defaults from purpose: decision uses explore; other purposes use annotate.",
        ],
        helpOption: "  --help              Show this help",
        example: "review-artifact open docs/features/example/specs.html --no-open",
      },
    },
    poll: {
      booleanOptions: {},
      valueOptions: {
        "--agent-reply": {
          default: null,
          duplicateError: "--agent-reply may be provided only once",
          missingError: "--agent-reply requires a value",
          validate: (value) => value.trim().length > 0,
          invalidError: () => "--agent-reply requires a non-empty value",
          help: "  --agent-reply <text>  Send a concise reply before waiting",
        },
      },
      positionalCount: 1,
      positionalError: "poll accepts exactly one HTML file",
      help: {
        usage: "review-artifact poll <html-file> [--agent-reply <text>]",
        summary: "Wait for feedback or approval; --agent-reply sends text before waiting.",
        description: "Wait for feedback or approval on an open review.",
        arguments: ["  html-file             Existing reviewed .html or .htm file"],
        defaults: [],
        helpOption: "  --help                Show this help",
        example: "review-artifact poll docs/features/example/specs.html --agent-reply \"Updated the heading\"",
      },
    },
    end: {
      booleanOptions: {},
      valueOptions: {},
      positionalCount: 1,
      positionalError: "end accepts exactly one HTML file",
      help: {
        usage: "review-artifact end <html-file>",
        summary: "End a review without approving it.",
        description: "End an open review without approving it.",
        arguments: ["  html-file  Existing reviewed .html or .htm file"],
        defaults: [],
        helpOption: "  --help  Show this help",
        example: "review-artifact end docs/features/example/specs.html",
      },
    },
    stop: {
      booleanOptions: {},
      valueOptions: {},
      positionalCount: 0,
      positionalError: "stop accepts no arguments",
      rejectAllArgumentsFirst: true,
      help: {
        usage: "review-artifact stop",
        summary: "Stop the local review server.",
        description: "Stop the local review server.",
        arguments: [],
        defaults: [],
        helpOption: "  --help  Show this help",
        example: "review-artifact stop",
      },
    },
  },
});

const COMMAND_NAMES = new Set(Object.keys(REVIEW_COMMAND_SCHEMA.commands));
const HELP = Object.freeze({
  top: renderTopHelp(),
  ...Object.fromEntries(Object.entries(REVIEW_COMMAND_SCHEMA.commands).map(([name, schema]) => (
    [name, renderCommandHelp(schema)]
  ))),
});

export function parsePrivateServerInvocation(argv) {
  if (argv[0] !== "server") return false;
  if (argv.length !== 1) throw usageError("server accepts no arguments");
  return true;
}

export function parseReviewInvocation(argv) {
  const help = requestedHelp(argv);
  if (help) return { type: "help", text: help };

  const normalized = normalizeArguments(argv);
  const command = normalized[0];
  if (!command) throw usageError("An HTML file or command is required");
  const schema = REVIEW_COMMAND_SCHEMA.commands[command];
  if (!schema) throw usageError(`Unknown command: ${command}`);

  const parsed = parseCommandArguments(command, normalized.slice(1), schema);
  if (command === "open") {
    return {
      type: "command",
      command,
      file: parsed.positionals[0],
      purpose: parsed.values["--purpose"],
      mode: parsed.values["--mode"],
      noOpen: parsed.booleans["--no-open"],
      reopen: parsed.booleans["--reopen"],
    };
  }
  if (command === "poll") {
    return {
      type: "command",
      command,
      file: parsed.positionals[0],
      reply: parsed.values["--agent-reply"],
    };
  }
  if (command === "end") return { type: "command", command, file: parsed.positionals[0] };
  return { type: "command", command };
}

function parseCommandArguments(command, args, schema) {
  if (schema.rejectAllArgumentsFirst && args.length > 0) {
    throw usageError(schema.positionalError, command);
  }
  const knownOptions = new Set([...Object.keys(schema.booleanOptions), ...Object.keys(schema.valueOptions)]);
  const unknown = args.find((argument) => argument.startsWith("-") && !knownOptions.has(argument));
  if (unknown) throw usageError(`Unknown option for ${command}: ${unknown}`, command);

  const booleans = Object.fromEntries(Object.entries(schema.booleanOptions).map(([option, definition]) => (
    [option, args.includes(option) ? true : definition.default]
  )));
  const values = {};
  for (const [option, definition] of Object.entries(schema.valueOptions)) {
    const occurrences = args.filter((argument) => argument === option).length;
    if (occurrences > 1) throw usageError(definition.duplicateError, command);
    const optionIndex = args.indexOf(option);
    const value = args[optionIndex + 1];
    if (optionIndex !== -1 && (value === undefined || value.startsWith("--"))) {
      throw usageError(definition.missingError, command);
    }
    if (optionIndex !== -1 && !definition.validate(value)) {
      throw usageError(definition.invalidError(value), command);
    }
    values[option] = optionIndex === -1 ? definition.default : value;
  }
  const positionals = positionalArguments(args, new Set(Object.keys(schema.valueOptions)));
  if (positionals.length !== schema.positionalCount) throw usageError(schema.positionalError, command);
  return { booleans, positionals, values };
}

function requestedHelp(argv) {
  if (argv.length === 1 && argv[0] === "--help") return HELP.top;
  if (argv.length === 2 && argv[1] === "--help") return HELP[argv[0]] ?? null;
  return null;
}

function normalizeArguments(argv) {
  const first = argv[0];
  if (!first || COMMAND_NAMES.has(first)) return argv;
  return /\.html?$/i.test(first) ? ["open", ...argv] : argv;
}

function positionalArguments(args, valueOptions) {
  const positionals = [];
  for (let index = 0; index < args.length; index += 1) {
    if (valueOptions.has(args[index])) index += 1;
    else if (!args[index].startsWith("-")) positionals.push(args[index]);
  }
  return positionals;
}

function renderTopHelp() {
  const commands = Object.entries(REVIEW_COMMAND_SCHEMA.commands);
  return [
    "Usage:",
    `  ${REVIEW_COMMAND_SCHEMA.top.shorthandUsage}`,
    ...commands.map(([, schema]) => `  ${schema.help.usage}`),
    "  review-artifact --help",
    "",
    "Commands:",
    ...commands.map(([name, schema]) => `  ${name.padEnd(5)} ${schema.help.summary}`),
    "",
    "Defaults:",
    ...REVIEW_COMMAND_SCHEMA.top.defaults,
    "",
    "Example:",
    `  ${REVIEW_COMMAND_SCHEMA.top.example}`,
    "",
  ].join("\n");
}

function renderCommandHelp(schema) {
  const optionLines = [
    ...Object.values(schema.booleanOptions).map(({ help }) => help),
    ...Object.values(schema.valueOptions).map(({ help }) => help),
    schema.help.helpOption,
  ];
  return [
    `Usage: ${schema.help.usage}`,
    "",
    schema.help.description,
    ...(schema.help.arguments.length > 0 ? ["", "Arguments:", ...schema.help.arguments] : []),
    "",
    "Options:",
    ...optionLines,
    ...(schema.help.defaults.length > 0 ? ["", "Defaults:", ...schema.help.defaults] : []),
    "",
    "Example:",
    `  ${schema.help.example}`,
    "",
  ].join("\n");
}

function deepFreeze(value) {
  Object.freeze(value);
  for (const nested of Object.values(value)) {
    if (nested && typeof nested === "object" && !Object.isFrozen(nested)) deepFreeze(nested);
  }
  return value;
}

function usageError(message, command = null) {
  return Object.assign(new Error(message), { code: "USAGE_ERROR", command });
}
