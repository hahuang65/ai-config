# Guardrail policies via ports-and-adapters projection

Security intent (never read secrets, no force-push, no curl-pipe-to-shell) is currently duplicated across mechanisms in incompatible formats — a Claude shell hook (`scripts/hooks/deny-curl-to-interpreter.sh`), oh-my-pi TS hooks (`omp/hooks/pre/guard-*.ts`), and TTSR rules — each a hand-written reimplementation of the same intent. ADR-0004 predicted this drift ("the Claude hook will diverge from the oh-my-pi TTSR rule over time"). Adding **pi** would add a third copy. We adopt a **ports-and-adapters** model: one canonical policy registry, one shared detection core, thin per-harness adapters, and a conformance test. This **supersedes ADR-0004's decoupling stance.**

## Why this reverses ADR-0004

ADR-0004 decoupled permissions ("oh-my-pi is decoupled by design; no permission sync") because the only alternative on the table was the brittle `scripts/sync-permissions.py` config compiler (the Claude↔OpenCode bridge, removed in ADR-0009). That compiler tried to translate one harness's *static config* into another's — and it could never express paradigm gaps (pattern-deny vs VM-sandbox). ADR-0004 never considered the third path: **share the detection *logic*, project only the *transport*.** That path is now viable because two of the three harnesses (pi, oh-my-pi) descend from the same lineage and expose near-identical TS `tool_call` hook APIs (`(event, ctx) => { block, reason }`), and the third (Claude) can invoke the same logic through a command shim.

## The model

- **The policy registry.** One entry per guardrail: an **ID**, human-readable intent, enforcement metadata (check kind: `path`/`command`/`network`/`secret`; minimum strength), and two boundary cases (`example` violation + benign `counterExample`). The canonical source of truth for *what*, harness-neutral and stable across harness churn. *Implemented as the single file `shared/policy-registry.ts` — small enough not to warrant the `policies/` directory this ADR originally imagined; revisit if it grows or wants per-policy intent docs.*
- **`shared/guard-core.ts` — the guard core.** Pure detection functions (`isSecretPath`, `isCurlPipeShell`, …) keyed by policy ID. The single source of truth for *how to detect*, written once.
- **Per-harness adapter, classified by enforcement tier:**
  - **A — programmable** (pi, oh-my-pi): wire the guard core into the harness's in-process `tool_call` hook.
  - **B — command-hook** (Claude Code): a ~15-line stdin/stdout shim normalizes Claude's hook JSON, calls the *same* guard core, and emits Claude's verdict JSON. Claude additionally keeps its static `settings.json` deny patterns as fast declarative defense-in-depth.
  - **C — declarative** (static allow/deny only), **D — sandbox** (environment isolation), **E — guidance** (prompt text only): reusable archetypes for harnesses that can't run the core, projecting the registry as far as the mechanism allows.
- **Conformance test — the coverage matrix.** Contract **(a)**: a **mandatory policy floor** (e.g. `no-secret-access`) every harness must enforce at tier A/B/C/D strength — a harness that can't must be sandboxed or rejected — plus an *explicit* (never silent) gap for every other policy. The strictness is one line in the test to tighten later ("floor + gaps" → "total coverage").

## Trade-offs

- The guard core needs a TS runtime where it executes: free for pi/oh-my-pi (jiti, no compile), but the Claude shim needs `bun`/`node` on PATH, and Claude's static patterns stay declarative (can't call TS) — so Claude is deliberately two-tier.
- We accept shared *executable* code across harness boundaries (a coupling) in exchange for killing the three-way logic drift ADR-0004 flagged. The coupling is contained to detection logic; transport stays per-harness.

## Consequences

- **Supersedes ADR-0004's pillars 1–2** (hand-authored decoupled config, no shared enforcement) and folds **ADR-0006's** hook-vs-TTSR split into the oh-my-pi adapter's *internal* implementation choice. ADR-0003 (TTSR) survives as one tactic an adapter may use.
- Adding a harness is bounded and known: classify its tier, write a thin adapter (near-zero for A/B), run the conformance test.
- Runtime **sandboxing** (Gondolin) is orthogonal — a tier-D isolation layer for pi, not part of the policy contract.
- Pairs with ADR-0010's isolation test: **coverage** (every harness enforces the floor) and **isolation** (no harness leaks into another) are the two CI-checked invariants of the fleet.
