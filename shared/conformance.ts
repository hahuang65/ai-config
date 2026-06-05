// conformance.ts
//
// The conformance contract (ADR-0011, contract "a"): every harness must
// enforce every policy on the mandatory floor. This module holds the pure
// coverage logic — which floor policies a coverage map leaves uncovered, and a
// readable coverage matrix. The live coverage (probing each harness adapter)
// is assembled in the conformance test and fed through findFloorGaps.

import { POLICIES, type Policy } from "./policy-registry";

/** policyId -> harness name -> is the policy enforced by that harness? */
export type Coverage = Record<string, Record<string, boolean>>;

export interface Gap {
  policy: string;
  harness: string;
}

export function floorPolicies(): Policy[] {
  return POLICIES.filter((p) => p.floor);
}

/**
 * Floor policies a harness fails to cover. Non-floor gaps are deliberately
 * NOT returned — they are allowed, explicit gaps, surfaced only in the matrix.
 */
export function findFloorGaps(coverage: Coverage, harnesses: string[]): Gap[] {
  const gaps: Gap[] = [];
  for (const policy of floorPolicies()) {
    for (const harness of harnesses) {
      if (!coverage[policy.id]?.[harness]) gaps.push({ policy: policy.id, harness });
    }
  }
  return gaps;
}

/**
 * A readable policy × harness coverage matrix. Floor policies are labelled;
 * a floor cell that is uncovered is a hard "GAP", a non-floor cell that is
 * uncovered is an allowed "—".
 */
export function formatMatrix(coverage: Coverage, harnesses: string[]): string {
  const idWidth = Math.max(...POLICIES.map((p) => p.id.length), 12);
  const header = `${" ".repeat(8)}${"policy".padEnd(idWidth)}  ${harnesses.join("  ")}`;
  const rows = POLICIES.map((policy) => {
    const tag = policy.floor ? "[floor] " : "        ";
    const cells = harnesses.map((harness) => {
      if (coverage[policy.id]?.[harness]) return "covered";
      return policy.floor ? "GAP" : "—";
    });
    return `${tag}${policy.id.padEnd(idWidth)}  ${cells.join("  ")}`;
  });
  return [header, ...rows].join("\n");
}
