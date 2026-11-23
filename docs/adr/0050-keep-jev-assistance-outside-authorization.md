# Keep Jev assistance outside authorization

Status: accepted.

## Problem

Reviewers spend reasoning context on discovery and repeated checklist construction.
Finding evidence and duplicates also benefit from focused semantic questions.
Existing deterministic guards cannot judge every departure from a user's request.
A probabilistic classifier could help, but must not become a permission authority or silently remove evidence.
Sharing source with another service also expands the existing request-text-only Worklog data flow.

## Decision

Add two separate, default-off opt-ins.
`review-change --jev` permits bounded eligible review evidence to reach TypeSafe for supplemental reading priorities, checklist scores, and visible finding assessments.
`AI_JEV_SCOPE=1` permits bounded recent user requests and action metadata for additional scope objections in native sessions.
Keep ordinary resource discovery and independently configured TypeSafe and Herdr settings unchanged.

Use the existing native Pi classifier and authentication APIs with a pinned model.
Rust owns review orchestration, budgets, validation, retained state, and HTML rendering.
A small native bridge supports the Rust process and Claude hook without creating an agent session or another public CLI.
Pi's in-process guard uses its existing native model registry.
Claude isolates discovery and SDK startup in an owned subprocess with a parent-enforced deadline before the hook timeout.
A synchronous startup stall cannot turn unavailable scope judgment into a host-dependent timeout.
Keep a separate supervisor as the process-group leader until cleanup so worker exit cannot release ownership before SDK helpers stop.
An owner pipe and supervisor fail-safe also stop the group if the caller dies.
Known credential-literal patterns remain shared with the deterministic credential guard.

Priorities cannot restrict changed-file coverage, eligible evidence, further reads, or mandatory checks.
Checklist scores cannot excuse review.
Finding assessments cannot delete, merge, downgrade, repair, or publish findings.
Wording changes invalidate finding assessments rather than showing stale scores as current.
Scope concerns and unavailable scope judgments require clarification.
A low drift score returns no additional objection, never an allow decision or proof of approval.

Preserve the deterministic policy registry, parser failure behavior, protected paths, source snapshot checks, human repair decisions, and exact publication confirmation.
Existing denials run before classifier assistance and cannot be overridden.
Classifier outputs are validated numeric data, not generated instructions.

## Alternatives and consequences

Replacing deterministic guards with Jev was rejected because a probabilistic answer cannot establish permission.
Using ranking as a file filter or silently suppressing findings was rejected because it could hide defects.
A new Rust HTTP/authentication stack was rejected in favor of the existing native provider and credentials.
Reusing ordinary agent sessions for classification was rejected because it would load unnecessary context, tools, and discovery.
Direct native authentication reuse adds process startup overhead for CLI and Claude calls.

Assistance adds calls and does not establish savings by itself.
Reports retain successful-call usage and time, with explicit limits for failed or partial assessment.
Scope classification has incomplete visibility into write contents, arbitrary scripts, and older intent outside its bounds.
It is not an operating-system sandbox or an authorization record.
Synthetic fixtures prove integration and boundaries, not semantic quality or real-provider cost reductions.
Private-source evaluation needs separate data-sharing approval.

See [Jev assistance](../jev-assistance.md) for opt-ins, limits, and verification.
The [parser decision](0042-use-tree-sitter-for-command-guards.md), [publication decision](0043-separate-pr-publication-from-local-repairs.md), and [restricted review workflow](0047-guard-native-specialists-and-overlap-verification.md) remain authoritative.
