# Authoring this Claude and Pi package

Shared resources live at the root in `baseline.md`, `skills/`, `agents/`, `commands/`, `rules/`, and `guard/`.
Claude-specific adapters live under `harnesses/claude/`, Pi-specific adapters under `harnesses/pi/`, and exact installed destinations in `manifest.json`.
Production Rust tools are under `tools/`; the adapter TypeScript remains where a harness needs it.
Read `CONTEXT.md` for vocabulary and [`README.md`](README.md) for the current package; explicitly historical sections and older decision records describe former workflows.
The current installation links to this checkout at `~/.dotfiles/ai`; switching that live source needs separate approval.
Do not run any retained trial installer or attempt to switch live links for a test.
Do not stage, commit, push, or update the parent submodule pointer without separate authorization.

## Add or change a resource

1. Establish the task worktree according to `baseline.md` before writing a failing behavior test or any other repository file.
   Then start with one observed failing behavior test and make the smallest production change.
2. Update the manifest, package catalogue, fixtures, and source together for an owned resource.
   Never absorb an existing personal file or enable a legacy service just to pass a test.
3. Bundle symlinked Pi extensions with imports the installed Node loader cannot resolve.
   Keep ordinary resource discovery enabled; restrict only the dedicated reviewers.
4. Run focused tests, `make lint`, and the `make test` gate before a commit is considered.
   Keep Rust CLI tests in each crate's `tests/`, cross-harness adapter tests in `test/`, and browser integration tests with the artifact-review tool.
   Browser tests must use the bounded browser harness, not unbounded parallel launches.
5. `make build` creates release artifacts offline; it does not install.
   Installation requires a separate explicit `./install.sh` invocation and separate approval for a live home.
   That entry point builds this checkout and performs ownership, link, and settings transactions itself, using the JSON-only filters and catalogue in `tools/install/`.
   It requires jq and GNU coreutils but does not provision build tools or dependencies.
   Never bypass a retained transaction lock or incomplete rollback; inspect and recover explicitly.
   Preserve the live ownership record, model/authentication choices, conversations, independent TypeSafe and Herdr settings, and unrelated resources.

For rule-loading and safety guidance, follow `baseline.md`, installed through each harness's global instruction link, and its root `rules/` directory.
The guarded actions are implemented by the shared policy registry and per-harness adapters, not by advisory prose alone.
Review publication remains human-confirmed in a real terminal.
Do not query or import old Work log history.
