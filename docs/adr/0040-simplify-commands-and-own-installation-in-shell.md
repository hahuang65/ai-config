# Simplify commands and own installation in shell

Status: accepted; implementation and legacy retirement are in progress.

## Problem

The package exposed overlapping executable names, a generic evaluation command, and an installation wrapper that delegated its real work to another executable.
The user wants fewer commands, clear provenance, and one installation implementation rather than another wrapper around the same machinery.
Consultation is useful before implementation, not only during source review.

## Decision

Keep five useful executables: `wt`, `wl`, `review-change`, `review-artifact`, and `consult`.
Expose `wt`/`worktree`, `wl`/`worklog`, and `review-change` as symlinks to binaries in the installed source.
Keep `review-artifact` and `consult` inside that source without PATH aliases; consumers resolve them from the installed configuration source, not arbitrary task checkouts.
The restricted reviewer remains shared internal code rather than a generic `evaluation` command.
Retire `evaluation`, `ai-config`, and alternative installation entry points once their consumers and verification are migrated.
[ADR 0041](0041-retire-unrecorded-installation-adoption.md) settles the remaining adoption boundary: retain recorded upgrades, retire unrecorded legacy adoption.

`install.sh` builds its own checkout and owns filesystem changes, settings transactions, locking, and handled-failure rollback.
It does not delegate installation to Rust, Python, Make, or another executable.
JSON-only jq filters and catalogue data may be separate files; they neither install resources nor expose another command.
The user approved jq and GNU coreutils as required dependencies, with clear preflight errors and no automatic provisioning.
GNU exact-destination replacement avoids interpreting a changed destination directory as a place to move files into.
Unknown numeric tokens must survive JSON processing unchanged; plain jq numeric serialization is insufficient for that contract.

Retire Orchard, agentmemory, and the former review-publication service without deleting worktrees, histories, or retained review evidence.
Orchard's owning Git repository requires its own authorized task worktree.
Protected publication state and live service cleanup remain human-terminal work; retirement is not permission to bypass their guards.
Keep human-confirmed publication under `review-change post`, including existing report formats and reconciliation markers.
[ADR 0042](0042-use-simple-review-subjects-and-browser-publication.md) supersedes that human interface with browser confirmation, while retaining the existing reconciliation machinery and an unadvertised terminal compatibility path.
This replaces the selected agentmemory and socket-publisher workflows described in ADRs 0037 and 0038, not their historical evidence.

## Alternatives and consequences

Copying binaries into PATH or a private libexec directory was rejected in favor of symlinks and visible source provenance.
Putting consultation under `review-change` was rejected because consultation is broader than reviewing a change.
A shell wrapper around a Rust installer was rejected because the user wants installation ownership in the script itself.

Off-PATH placement is a convenience, not an authorization boundary against the same OS user.
Rebuilding the installed source updates its linked and source-local tools; task-checkout builds stay separate.
Installation, commits, publication, and switching the live source retain separate approval requirements.

The shell installer uses a lock directory and verifies current targets, file bytes, and permissions before changing or reversing them.
It never automatically breaks a lock or overwrites a concurrent edit to complete rollback.
An interrupted or incomplete transaction can require human recovery from retained private files.
Installation is not crash-atomic, and old Rust installers must not run concurrently during migration because they use a different lock mechanism.
Existing ownership records remain the authority for upgrades; unrecorded resources are not silently adopted.
Ordinary harness resource discovery and independent TypeSafe and Herdr configuration remain unchanged.
