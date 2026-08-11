# Run conditional UI mockups before the spec

The `/build` pipeline invokes the standalone `mockup` skill after grilling and before `spec` when a feature adds or materially changes an end-user interface.
The resulting canonical `mockups.html` is reviewed through `review-artifact`, and its explicit approval clears the Design→Spec gate that post-grill chat confirmation clears for work without relevant UI.
This order lets visual and interaction decisions shape the spec without adding a fifth pipeline approval gate.

## Considered Options

- Put mockup generation inside `spec`, which would mix design exploration with specification synthesis.
- Approve the spec before creating a mockup, which would make mockup feedback reopen approved intent.
- Rely only on UI prototyping outside `/build`, which would not consistently review material UI changes.
- Add a conditional standalone `mockup` skill before `spec`, which keeps the workflow reusable and gives the spec settled design input.

## Consequences

- `mockups.html` remains Authoritative intent with the selected design, rationale, and any rejected alternatives.
- Later pipeline skills consume the artifact when present and validate material implementation drift without requiring pixel equality.
- The existing `prototype` skill remains throwaway runnable code and invokes `mockup` first only when end-user UI design is its subject or an imperative prerequisite.
