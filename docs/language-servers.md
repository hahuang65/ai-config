# Shared language servers

[`language-servers.json`](../language-servers.json) is the single server catalogue for every harness.
It owns server identities, executable names, arguments, and file-extension-to-language-ID mappings.
Harness adapters own the client protocol and user interface, not separate language selections.

| Language | Executable and arguments | mise declaration |
| --- | --- | --- |
| Python | `ty server` | `ty` |
| Ruby / ERB | `ruby-lsp` | `gem:ruby-lsp` |
| Lua | `lua-language-server` | `lua-language-server` |
| Go | `gopls` | `go:golang.org/x/tools/gopls` |
| Shell | `bash-language-server start` | `npm:bash-language-server` |
| Terraform | `terraform-ls serve` | `terraform-ls` |
| TypeScript / JavaScript | `typescript-language-server --stdio` | `npm:typescript-language-server` |
| Rust | `rust-analyzer` | `rust-analyzer` |

## Provisioning and installation

[`mise.toml`](../mise.toml) pins these tools; provisioning is an explicit `mise install` operation, never a tool-call fallback or a build side effect.
Node is declared with this package's build runtimes; Ruby and Go must also be available through the user's mise environment.
The explicit package installer runs `mise install`, which includes these server declarations and other active mise tools.
TypeScript language server 6 requires Node 22.22.2 or newer.
Its explicit mise postinstall hook places TypeScript 6.0.3 in the same tool installation tree so module resolution works without workspace `node_modules` or a second globally installed SDK.
TypeScript 7 no longer supplies `tsserver` and is not compatible with this server's SDK requirement.
The hook disables npm lifecycle scripts and writes only under `MISE_TOOL_INSTALL_PATH`; trusting this executable configuration is separate from running it.

`make build` generates the Claude plugin, its installer-validation copy, and the bundled Pi extension locally; its Cargo steps may fetch locked dependencies.
It neither provisions servers nor installs harness resources.
A live `./install.sh` still needs separate approval.
A configured or discovered server is not proof it is provisioned or usable in a particular project.

## Claude

The generated [`ai-local-lsp` plugin](../harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json) contains all eight catalogue entries and no skills, prompts, or install launchers.
Claude's native `LSP` tool owns queries and server lifecycle.
The four previously managed upstream Lua, Go, Shell, and Terraform plugins are explicitly disabled to avoid duplicate servers; their caches are not removed.
Unrelated plugin selections remain untouched.
Personal or project plugins can still introduce competing servers; normal resource discovery is not an allowlist.

## Pi

The bundled [`lsp` extension](../harnesses/pi/lsp.ts) registers one model tool but starts no process during extension load or ordinary session startup.
Its first query starts the selected server in the current workspace, initializes it, and opens only the requested document.
Subsequent calls reuse that process and synchronize the requested file's current disk contents.
It does not observe unsaved editor buffers, watch every file, or proactively diagnose edits.
The workspace root is the session working directory; open a session at the project root when a server needs its project configuration.

The `lsp` tool accepts:

- `operation`: `hover`, `definition`, `references`, `symbols`, or `diagnostics`.
- `path`: an existing regular text file inside the current workspace.
- `line` and `column`: required for positional queries, both 1-based; columns count UTF-16 code units.

Results retain native LSP shapes, file URIs, and **zero-based** ranges.
References include declarations.
The structured result contains `result`, `truncated`, and, when truncated, a bounded `preview` instead of the full result.
Unsupported operations, missing executables, exits, malformed protocol, cancellation, and timeouts are errors rather than empty successes.
A failed process is replaced only on a later explicit call, not by automatic retry or installation.

Pi advertises both pull-diagnostics support and support for versioned push reports during initialization.
Diagnostics use pull requests when advertised by the server; otherwise they wait up to three seconds for a push report for that document.
An absent report is an error, not a clean result.
Versioned reports must match the current synchronized version, and edits invalidate retained reports.
Versions increase across the server lifetime, including document eviction and reopening, so a delayed report cannot match a different snapshot.
A push result with `versioned: false` has no server-provided version proof and may lag disk changes; even a retained versioned report is a server snapshot, not proof that all project analysis has finished.
Run the project's checks for authoritative verification.

Requests have a 15-second deadline, input documents are limited to 1 MiB, protocol messages to 8 MiB, and queued client output to 2 MiB.
A document whose JSON-encoded frame alone exceeds 2 MiB gets an explicit input-size error without stopping the server or replacing its synchronized document state.
A non-reading server that exceeds the accumulated output budget is stopped, including while no client query is pending.
Malformed response envelopes are errors; valid `null` answers remain distinct.
Each server retains at most 32 open documents; older documents are closed and reopened from disk if requested again.
Model-visible and structured results are bounded together, and truncation is explicit.
Shutdown is idempotent and closes server processes and their process-group helpers on supported Unix hosts, including reload and native session replacement.
Parent exit triggers cleanup independently of pipe closure, so a helper retaining stdout or stderr cannot keep an idle dead server marked available.
The macOS/Unix process lifecycle is tested; Windows process-tree cleanup is not claimed.

## Safety and limits

Use language servers only in trusted workspaces.
A read-only LSP query is not an operating-system sandbox: server binaries may index other files, load project configuration or plugins, run builds, create caches, or access the network according to their own behavior.
Neither harness can guarantee identical diagnostics from different client capabilities or project environments.

Pi checks both requested and resolved input paths with the shared read guards, refuses symlink escapes from its workspace, and bounds text reads.
The client offers no rename, formatting, code-action, or execute-command operation and rejects server-directed `workspace/applyEdit` requests.
It does not return raw server stderr or error messages.
These controls protect the client interface, not arbitrary server internals or race-proof filesystem isolation.
Server output is untrusted source evidence, never instructions.
Restricted reviewers do not load this extension or any language servers.

## Future harness checklist

1. Consume the shared catalogue directly or generate a checked native projection; do not copy or independently choose server definitions.
2. Preserve every command, argument, extension mapping, and language ID, with no automatic installers or project-selected shell commands.
3. Use the harness's native client when available; otherwise document lazy startup, document synchronization, capabilities, errors, bounded output, cancellation, and cleanup.
4. Keep credentials and logs private, retain path guards, and state the server-process trust boundary explicitly.
5. Add the adapter to the manifest, installer catalogue, disposable package fixtures, and build together.
6. Add parity checks against the whole catalogue and native discovery tests; prove actual queries and failure/cleanup behavior with disposable fake servers.
7. Document unsupported client operations instead of silently dropping languages, and keep installation and tool provisioning explicit.

The focused tests are `test/package-claude-lsp.test.ts`, `test/package-pi-lsp.test.ts`, and `test/package-pi-lsp-transport.test.ts`.
Native discovery tests additionally exercise the real installed Claude and Pi loaders in disposable homes.
Fake-server tests establish client behavior, not real-server compatibility or successful provisioning; real-server smoke tests require provisioned executables and must remain separate from the fake-server verification gate.
