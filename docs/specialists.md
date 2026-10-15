# Read-only specialists

The standalone Rust review tools use five explicit, trusted role files under `agents/`:
`api-designer`, `frontend-architect`, `database-reviewer`, `fact-checker`, and `change-reviewer`.
Do not discover roles from the reviewed repository.
The `change-reviewer` is used for HTML change reports; other roles are optional consultation, never an automatic team or permission to edit.

To consult a role, build the Rust tools first, then run `tools/evaluation/target/release/consult --agent ROLE --repo ABSOLUTE_REPOSITORY --prompt TEXT` with safely quoted literal arguments.
The helper remains inside the installed configuration checkout, with no shell PATH alias.
Resolve it from that source, not an arbitrary task checkout or an unrelated executable on PATH.
Consultation also supports design questions with an empty diff; it is not limited to reviewing a change.
Use `--path` to limit the snapshot when appropriate.
The reviewer can read only a frozen, bounded snapshot, not execute commands or inspect project credentials.
The Pi runner uses a private ephemeral profile with ordinary authentication linked rather than copied; Claude uses its own restricted runner and does not need Pi.
Model calls require explicit approval in an agent-driven workflow; never treat consultation as the required HTML change review.
Reports and consultation records live under `~/.local/state/ai-config/change-reviews`, separately from the evaluation checkout's retained `.state/pi` and ordinary conversations.
