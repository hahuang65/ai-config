# Clarification questions

Use structured questions to settle requirements and preferences, not to add workflow approval gates.
The shared `grill`, `model-domain`, `plan`, and `spec` skills suggest them for real choices.
`code` and `coach` use them only for actual intent blockers, not routine checkpoints.
Use ordinary chat when the host has no question tool or its UI is unavailable.
Cancellation leaves the question unresolved.
Do not invent an answer or reopen it automatically.

## Native interfaces

Claude uses its native `AskUserQuestion`, explicitly allowed by the package.
An approved installation retires the formerly owned denial, but independent deny rules can still block it.

Pi provides the owned `ask_user_question` tool from [source](../harnesses/pi/ask-user-question.ts).
The installer links its generated bundle at `~/.pi/agent/extensions/ask-user-question.ts`.
It uses native `select` and `input` dialogs in TUI and RPC modes, without custom terminal components.
Trade-offs appear in the wrapped dialog title, with short numbered choices below.
A choice question always includes **Type my own answer...**.
Omit `options` for an open text question instead of inventing alternatives.

Example model-call arguments:

```json
{
  "question": "Where should the prototype store its data?",
  "options": [
    {"label": "SQLite (recommended)", "description": "Simple local setup; one writer."},
    {"label": "Postgres", "description": "Shared writes; requires a service."}
  ]
}
```

Pi accepts one question with two to four labelled choices and required trade-off descriptions, or one open question.
It runs sequentially and is `model-only`, so codemode scripts and nested tool calls cannot invoke it.
Headless sessions withdraw its declaration; stale execution returns `unavailable` without opening a dialog.
The tool starts no processes, opens no external editor, and adds no answer channel, service, or separate state store.
Normal tool results remain in the conversation, so do not request secrets.

### Herdr status

Terminal questions emit `herdr:blocked` with `active: true` and the fixed label `Waiting for your answer` before opening a dialog.
One matching `active: false` event clears that wait after an answer, dismissal, abort, invalid response, or UI failure.
The wait spans both choice and custom-text dialogs without an intermediate clear.
Question and answer text are not included in these status events.
RPC, headless, and already-aborted calls emit no Herdr status events.

The independently configured Herdr observer owns terminal state reporting and notifications.
It reports `blocked` while waiting, returns to `working` when the dialog finishes, and reports `idle` only when Pi emits `agent_settled`.
Finishing a question does not mean the agent has finished its work.
The question tool does not synthesize completion events, contact Herdr directly, or require the observer to be installed.
Herdr configuration remains separately owned and unchanged.

## Results and limits

Pi returns the same data in model-facing JSON text, `details`, and `structuredContent`, with a declared output schema:

- `answered`: the question and an `answer` containing either `kind: "choice"`, a zero-based `index`, and `label`, or `kind: "text"` and `text`.
- `cancelled`: the question and `reason` of `dismissed`, `empty`, or `aborted`. No answer is supplied.
- `unavailable`: the question and `reason` of `no_ui`, `ui_error`, or `invalid_response`. Ask in ordinary chat if clarification is still needed.

Dialog calls receive the tool's abort signal, and late answers after cancellation are discarded.
Question and choice sizes are schema-bounded; custom answers are limited to 4000 UTF-16 code units.
Invalid client responses are not accepted as answers, terminal controls are neutralized for display, and private UI exceptions are not returned.

Question answers do not replace revision-bound whole-document approval, retained finding decisions, or exact publication confirmation.
They do not authorize staging, commits, live installation, delivery, or publication, and do not transfer implementation ownership in coaching.
RPC clients and trusted extensions can automate UI interactions; this is not proof of human presence.
Tabs, previews, multi-select, notes, external editing, and package-defined programmatic answer channels are outside this version.

## Verification

The adapter was checked against installed Pi 1.4.0 documentation and its Node resource loader.
`test/package-pi-questions.test.ts` uses disposable manifest links, controlled TUI/RPC dialog responses, schema checks, and source-to-bundle parity.
Its shared event-bus checks cover balanced waiting events, continuous custom-answer waits, failure cleanup, mode exclusions, and operation without a Herdr observer.
Installer tests cover recorded upgrades, preservation of personal settings/extensions, and refusal to adopt an unowned matching file.
These tests do not establish live installation, keyboard layout, or a real RPC client's rendering or response transport.
