# Materialize the selected local review head

A mutable local branch can select a fetched descendant that is newer than the source checkout's current commit.
Running child evidence in a clone that still has the source commit checked out would validate stale files while reporting the newer immutable range.

The standalone Review change parent therefore captures the source working snapshot before the isolated fetch, including its binary tracked patch and untracked files.
After it selects and freezes the descendant, it materializes that exact commit in the disposable local review workspace and replays the captured snapshot before starting pi.
The prompt and telemetry record the selected object ID and successful materialization state.
The source repository remains unchanged and is never fetched.

For every untracked destination, replay rejects a symbolic link in any ancestor and confirms each existing parent resolves beneath the canonical workspace before directory creation or copy.
Regular files use exclusive no-follow source and destination handles, verify source identity, recheck destination parents after open and copy, and fail closed on detectable path replacement within Node's file API limits.
Captured symbolic links remain supported only when they are relative and their lexical target stays inside isolation; replay creates the link itself and never follows a selected-head symbolic-link parent outside the workspace.
If the tracked patch conflicts, an untracked path collides with the selected tree, a path is replaced, or any snapshot path cannot be represented safely, Review change stops with a corrective error and removes the recorded workspace before running child evidence.
Local changes remain trusted under the existing local policy because this transition occurs only in the disposable local workspace.
An explicit immutable Git range does not rematerialize and retains its original isolated snapshot behavior.
