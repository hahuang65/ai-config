# Dangerous Bash command checks

Claude and Pi call the same guard core before running a model tool call.
The policy registry is `guard/policy-registry.ts`; the checks live under `guard/`.
Pi loads the generated `harnesses/pi/guard-policies.bundle.ts`.
These checks prevent recognizable mistakes, not hostile code with user-account access.

## Shared boundary

| Operation | Refused examples | Examples not refused by this check |
| --- | --- | --- |
| Formatting and erasure | `mkfs.ext4 /dev/example`, `newfs`, `mke2fs`, `mkswap`, destructive `wipefs`, `sgdisk`, `parted`, and `diskutil` operations | `diskutil list`, `parted /dev/example print`, `wipefs --no-act /dev/example`, standalone `--help` |
| Host interruption | `shutdown`, `reboot`, `poweroff`, `halt`, `init 0`, `telinit 6`, systemctl power/reboot/sleep actions | `systemctl status app`, standalone `shutdown --help` |
| Recursive deletion | `rm -rf ./src`, `rm -r .git`, `rm -rf /tmp/arbitrary`, find deletion actions | A direct `rm -rf ./build/cache` under the conditions below; `rm ./stale.log`; read-only find |
| Process termination | SIGKILL/9, process names or groups, unresolved PID expressions, `pkill`, `killall`, `killall5`, `xkill` | `kill -TERM 4242`, `kill -s TERM 4242`, `kill 4242`, `kill -0 4242`, `pgrep` |
| Download and execution | curl/wget output used as interpreter code through pipelines, evaluation arguments, substitutions, stdin redirects, or subsequent execution of a named download | Download-only commands, ordinary local scripts, downloaded data passed to `python3 -m json.tool` or an explicit data-processing program |

Other existing policies still apply, including credential protection, privileged commands, destructive Git commands, raw-device dd, infrastructure, deployment, database mutation, and broad chmod.
A guard non-denial is not permission from the user and does not prove the operation is safe.
Claude also retains its existing static permission denials, including the broader `Bash(rm *)`; passing the shared check does not override those settings.
This change does not relax or replace native permissions.

## Cleanup exception

The initial designated directory is exactly `build/cache` below the tool's current working directory, including descendants.
This preserves the existing registry's cleanup example; it does not infer that every directory named build, dist, target, cache, or tmp is disposable.
No repository setting, command flag, or environment variable can add an exception.
Changing the designated directory is a package policy change requiring review, not an automatic fallback after refusal.

The exception requires one direct rm invocation, an existing absolute working directory, literal paths, and no existing symlink below that working directory along any named operand's path.
Missing path suffixes are permitted, but lookup errors other than missing paths are refused.
Every recursive deletion operand must qualify; adding a safe operand does not authorize another target.
Variables, unquoted glob/brace expressions, parent traversal, redirects, compound commands, cwd-changing wrappers, and shell-wrapper cleanup are not exceptions.
Quoted punctuation remains a literal filename, not a shell operator; for example, `rm -rf 'build/cache/literal;name'` can qualify.
The working directory itself may have a platform alias such as macOS `/var`; checks resolve it before inspecting descendant components.
The designated directory is not proof of file ownership or contents, and concurrent filesystem replacement remains a race.

For other recursive deletions, the harness must hand the command to the user to inspect and run manually.
It must not work around a refusal by moving the target into the exception or using another language or tool to delete it.
The same manual boundary applies to formatting, host interruption, and forced or broad process termination.
An explicit PID is not evidence that the harness owns that process; approval and careful process identification still matter.

## Recognized syntax and limits

All command policies consume a shared tree-sitter-bash syntax tree rather than splitting or matching whole command strings.
That includes existing credential, Git, HTML, publication-state, deployment, and infrastructure checks, plus Claude's read-only GitHub permission shortcut.
Pipelines, redirections, executable substitutions, quoting, groups, and command boundaries come from the grammar.
Literal shell `-c` bodies, `eval` arguments, and shell programs supplied through heredocs or here-strings are parsed again as Bash.
Bash's effective `-n`/`+n` mode distinguishes syntax checking from execution; literal noexec bodies still undergo syntax validation, and substitutions executed by the outer shell remain inspected.
Descriptor duplication is evaluated in order so identity redirects preserve input and only the effective stdout destination receives download evidence.
Single-quoted examples and escaped substitution text are not executable substitutions.
Utility flags, path patterns, secret literals, and embedded non-shell program content retain bounded policy-specific matching; tree-sitter-bash does not interpret those languages or utility interfaces.

The parser uses pinned `web-tree-sitter` 0.27.1 and `tree-sitter-bash` 0.25.1 WASM artifacts, shipped locally with their licenses.
Claude initializes it before evaluating its hook input; Pi awaits initialization before evaluating a tool call.
There are no runtime downloads, native addons, or runtime `node_modules` requirements.
Missing parser assets, parse errors, and inspection-limit failures refuse Bash through `no-uninspectable-shell`; there is no text-parser fallback.
The pinned grammar's numeric-descriptor ambiguity is normalized using syntax-node ranges and exact adjacency, not a second shell lexer.
Other grammar gaps remain fail-closed, including valid descriptor-prefixed here-strings such as `2<<<text` that this grammar rejects.
Initialization has a one-second deadline; a late result cannot re-enable a timed-out guard.
WASM assets must be regular, non-symlink files no larger than 2 MiB each and are read asynchronously with bounded buffers; FIFOs are refused without waiting for a writer.
This does not preempt arbitrary blocking JavaScript or a stalled OS; the shipped runtime remains trusted package code.
After restoring missing assets, reload the harness.

Each input is limited to 64 KiB, a 100 ms parser progress budget, 16,384 copied nodes, 2 MiB of copied node text, and tree depth 128.
A decision reuses at most 64 parsed inputs and supports sixteen levels of nested-program traversal; nothing is cached across decisions.
Worker pathname patterns have separate size, depth, and expansion-count limits.
These are inspection limits, not a whole-tool execution deadline.

The guard does not resolve arbitrary aliases, variables, encoded programs, external script contents, every utility option, or arbitrary launcher wrappers.
Publication-state directory tracking accepts only syntax-proven literals and explicitly known variable values; uncertain directory changes remain refused.
Parsing Bash correctly does not make the guard a Bash evaluator or prove an unknown command's behavior.

Remote-execution evidence is limited to one tool call.
Named download outputs use recognizable curl/wget output options or stdout redirection, with or without adjacent whitespace, and lexical path matching relative to the supplied cwd.
Pipeline evidence crosses parenthesized groups; interpreter argument roles and the effective stdin redirect distinguish downloaded code from data.
For example, `curl URL | python -c 'import sys; print(sys.stdin.read())'` is not refused as remote execution.
Neither is `bash -s <(curl URL)`: with `-s`, that pathname is only a positional argument; `bash -s < <(curl URL)` supplies downloaded code on stdin and is refused.
The check does not simulate changed directories, track renamed files, or remember downloads across calls.
Separating download from execution permits inspection; it is not a trust attestation or automatic authorization to run that file.
A local script path alone cannot establish trust.

Commands hidden in scripts, alternate tools, filesystem races, and unrecognized shell forms can bypass these targeted checks.
Use operating-system isolation for a real execution boundary.
Do not describe the guard as a sandbox or a comprehensive dangerous-command detector.

## Verification

`test/package-dangerous-commands.test.ts` passes command strings to the Claude adapter, Pi source adapter, and generated Pi bundle, checking both denial and benign near misses.
It never executes the commands under test.
Path checks use disposable directories and symlinks; installer tests require all new guard dependencies before linking either adapter.
`test/package-guard.test.ts` still derives conformance examples from every registry entry.
`test/package-guard-parser.test.ts` checks generated-asset parity, actual Node/Pi loading through a disposable symlink without `node_modules`, missing runtime/grammar failures, and malformed or oversized Claude hook inputs.
`test/package-guard-parser-init.test.ts` checks stalled initialization, late grammar completion, oversized assets, and FIFOs through native adapters.
`test/package-github-guard.test.ts` checks Claude's syntax-based read-only permission shortcut.
The [parser decision](adr/0042-use-tree-sitter-for-command-guards.md) records the packaging trade-off.
The full package gate additionally checks native loading and installer ownership without changing the live installation.
