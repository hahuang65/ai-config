# PROTOTYPE — NOT PRODUCTION: native Claude feedback push

This bounded experiment asks whether a local Claude Channel can wake an idle native session, queue feedback behind a busy response, and deliver again after the session returns to idle.
It does not install a channel, change the live package, edit reviewed source, or publish anything.
Do not adopt these fixture modules as a production adapter.

## Run

Prerequisites are the existing macOS `sandbox-exec`, Bun, and Claude Code installations.
No dependencies or plugins are installed.
From this task checkout, run the following command in a separate real terminal:

```sh
bun test/prototypes/review-feedback-channel/run.ts
```

The native client requires interactive consent for the custom development channel.
Headless `-p` and Agent SDK sessions ignore that development-channel flag, so they cannot establish this result.
The fixture will not inject terminal input or accept consent for you.

Accept only prompts for the disposable workspace, the disposable fixture API key, and the `review_feedback_prototype` development channel.
Do not sign in or supply real credentials if the client asks for them.
After consent, the fixture supplies its initial synthetic prompt and runs automatically.
Do not type a work request into this session.

Five main-conversation responses exercise initial readiness, idle push, a deliberately held busy response, two queued notifications, and another idle push.
Auxiliary UI requests are counted separately and cannot establish feedback delivery.
Only a model request that actually contains the expected feedback counts as delivery.
An initialized MCP connection or a successful notification write does not count as success.
A short Stop observer reports response completion; it does not wait for feedback or deliver notifications.

The runner prints `PROTOTYPE_RESULT` with the outcome and bounded event counts, then closes its test client and loopback servers.
It stops within five minutes, with a shorter guard once feedback testing starts.
Press **Ctrl+C** to stop early.

## Isolation and retained state

The experiment uses a fresh private temporary home, synthetic responses, and a disposable API key.
The native process is sandboxed against external networking, writes to the real home, and reads of the normal harness and credential directories.
No source-editing tools are enabled.
The HTTP controllers bind only to loopback, and the channel-control endpoints require a per-run token.
No prompts, tokens, or environment dumps are printed by the fixture.

The native client requires filesystem state, so its isolated temporary home is the one persistence exception.
The runner prints that directory and retains it for inspection.
It does not delete prototype files or fixture state automatically.

## Fixture checks

```sh
bun test test/prototypes/review-feedback-channel/protocol.test.ts
```

These checks verify fixture plumbing only, not native channel acceptance or delivery.
Normal package startup and the standard test gate do not launch this interactive experiment.

## Limits

The current isolated native run reports that Channels is unavailable and ignores the development-channel flag.
An ordinary MCP connection can still succeed in that state; it does not establish push registration.
Availability in the normal authenticated client needs a separate check before another delivery trial.
The request classifier also needs validation: this isolated client did not emit the request-class header, so the fixture currently fails with a diagnostic rather than guessing which requests are conversation turns.
Request diagnostics include only bounded classes, counters, and fixed marker names, never raw prompts or headers.

If a future native trial passes, it establishes that installed client's local transport behavior with a synthetic provider.
It does not prove long-duration reliability, live-account eligibility, organization-policy compatibility, production routing, reconnect handling, or review-processing acknowledgements.
The minimal JSON-RPC fixture deliberately negotiates the supported MCP revision `2025-06-18`; it is not a general MCP implementation.
Startup consent and any policy restrictions must remain visible rather than being bypassed.
