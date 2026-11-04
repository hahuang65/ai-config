# Bind specialists to the running Pi host

Status: accepted.

## Problem

Homebrew upgrades can remove the version-specific installation recorded by a specialist build.
The adapter then fails at startup even when the new host supplies compatible SDK interfaces.
Retaining the old installation must not cause foreground children to load its SDK into the new process.

## Decision

Use Pi's extension-loader imports for the SDK, agent core, AI, terminal, and TypeBox modules.
Load the pinned specialist engine through Jiti with those modules bound for both Node and standalone hosts.
Bind absolute SDK entries as well, including a retained build-time entry that the engine can discover.
Keep the pinned engine check, explicit host-override check, owned policy check, required child extensions, and capability ceiling.
Do not require the running host's version to equal a historical build's version when all host modules come from the running process.
Missing build outputs or engine-loading incompatibility disable specialists with an actionable warning.
Policy and guard failures still fail closed.
Startup never relinks peers, downloads dependencies, or rebuilds the configuration.

Build-time exact-version SDK discovery and restoration remain unchanged.
The recorded host and peer links describe that build, not the host a later session must load.
This supersedes only the runtime host-version requirement in [ADR 0047](0047-guard-native-specialists-and-overlap-verification.md) and [ADR 0048](0048-match-sdk-to-standalone-pi.md).

## Consequences and limits

Compatible upgrades no longer require a specialist rebuild solely because their installation path or version changed.
Future incompatible APIs can still require an adapter update or rebuild.
The adapter cannot repair lazy imports inside a running Pi process after its own installation is deleted.
Preserve installation files until old processes exit, then restart Pi and resume saved conversations.
No package-manager settings, installed links, authentication, or sessions change as part of this decision.
