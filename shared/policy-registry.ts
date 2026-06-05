// policy-registry.ts
//
// The canonical, harness-neutral list of guardrail policies (ADR-0011). One
// entry per policy: an ID, its intent, the kind of check it performs, and a
// `floor` flag marking it as part of the mandatory policy floor every harness
// must enforce. This is the single source of truth for *what* must be
// enforced; detection logic ("how") lives in guard-core.ts.

export type PolicyKind = "secret" | "command";

export interface Policy {
  /** Stable identifier, e.g. "no-secret-access". */
  id: string;
  /** Human-readable statement of the guarantee. */
  intent: string;
  /** What the policy inspects: a path (secret) or a command string. */
  kind: PolicyKind;
  /** True if this policy is part of the mandatory floor (ADR-0011 contract a). */
  floor: boolean;
}

export const POLICIES: Policy[] = [
  {
    id: "no-secret-access",
    intent: "No harness may read credential or secret files.",
    kind: "secret",
    floor: true,
  },
  {
    id: "no-force-push",
    intent: "No harness may force-push, which rewrites shared history.",
    kind: "command",
    floor: false,
  },
  {
    id: "no-curl-pipe-shell",
    intent: "No harness may pipe a remote download into an interpreter.",
    kind: "command",
    floor: true,
  },
  {
    id: "no-broad-rm",
    intent: "No harness may recursively delete a broad target (/, ~, $HOME, *).",
    kind: "command",
    floor: true,
  },
  {
    id: "no-sudo",
    intent: "No harness may invoke sudo to escalate privileges.",
    kind: "command",
    floor: true,
  },
];
