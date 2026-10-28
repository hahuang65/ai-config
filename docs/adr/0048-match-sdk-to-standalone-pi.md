# Match the SDK to standalone Pi

Status: accepted.

## Problem

A standalone Pi binary does not include an importable Node SDK or its dependency tree.
The build previously assumed those files existed beside every installed Pi executable.
Changing Linux users to a Node-package installation would change their chosen installation method.

## Decision

Reuse an installed Node SDK when present.
Otherwise, read the selected standalone binary's `--version` and restore that exact SDK release into ignored `target/pi-sdk/VERSION/`.
Run restoration only through the explicit build prerequisite, never ordinary discovery or test assertions.
Use npm with lifecycle scripts, executable links, audits, and funding requests disabled.
Run `npm install` initially, then recreate the dependency tree with `npm ci` on every explicit SDK build.
Explicitly enable local lockfile generation, even when user npm settings disable it.
Require the checkout-local lockfile before marking successful, version-checked restores ready.
Discovery checks that marker, the SDK package name/version, and its entry file.
Refuse unsafe cache-root directories and root metadata links before writes or npm execution.
Keep SDK metadata reads within the cache and runtime peer links within its dependency tree.
Use hard-kill deadlines for version discovery and npm restoration.
A missing release, failed restoration, invalid version, or SDK mismatch fails without selecting another version.
Do not install a global client, replace the existing binary, change PATH, or alter harness settings.

Treat the SDK directory as disposable build output.
Let npm manage dependency integrity and Node resolve modules.
Do not implement a second package manager or module resolver to diagnose arbitrary cache corruption.
Use actual build and SDK-loading tests to check integration.
Rebuild damaged files with `make build-pi-sdk` rather than adding more cache-validation rules.

Use the SDK for build helpers, Node-based tests, and specialist library peers.
Inside the standalone process, load the specialist engine through Jiti with virtual-module bindings to Pi's embedded SDK.
Bind bare imports and the selected absolute SDK entry so foreground children keep the host's extension loader.
Check the active binary identity or SDK root, plus the exact SDK version, before delegation.

This extends the installed-SDK-only choice in [ADR 0047](0047-guard-native-specialists-and-overlap-verification.md).
The read-only facade, mandatory child guards, ordinary resource discovery, and separate installation approval remain unchanged.

## Alternatives and consequences

Requiring a Node-package Pi installation was rejected because standalone support is the selected goal.
Using an arbitrary or latest SDK was rejected because it can differ from the running host.
Running the downloaded SDK directly inside the binary was rejected after a native regression exposed imports bypassing Pi's embedded extension loader.
A custom dependency-tree and export validator was rejected after repeated edge cases expanded the task beyond SDK acquisition.

A new Pi version needs its matching published SDK and an initial network-enabled build.
Each explicit build repeats npm restoration, trading a small build cost for simpler behavior and a clear repair path.
The SDK's CLI source is incidental package content, not another installed command.
The generated lockfile fixes subsequent restores in that checkout, not dependency resolution across every machine.
Version equality does not certify custom builds or every future release's compatibility.
The real-binary synthetic-provider test checks the available standalone host without contacting a model service or changing live configuration.
