# Order state machine is linear, no back-transitions

The Order lifecycle is `pending → confirmed` or `pending → canceled`. No `confirmed → canceled`, no `canceled → pending`, no other paths.

## Why

A reader looking at the code will see only two outgoing edges from `pending` and zero from the terminal states. They'll wonder where the "refund" path is. The answer: it doesn't exist here. **Refunds are a Billing concern, not a Commerce concern.** When a Customer wants their money back after Fulfillment, Billing emits `RefundIssued` against the Invoice — the Order itself stays `confirmed`.

This split was a deliberate boundary decision (see also ADR-0003 on event ownership). Conflating refunds into the Commerce state machine was tempting because it's "obvious from the user's perspective," but it tangles Commerce's invariants with Billing's invoicing rules — and now Commerce has to understand payment methods, tax adjustments, and partial refunds. None of that is our problem.

## Consequences

- Commerce knows nothing about Refunds — the word doesn't appear in our code or events.
- A Customer who wants a refund after Fulfillment goes through Billing's flow, not ours.
- If a future requirement is "let Customers cancel a `confirmed` Order before shipping," that's a new edge — and we'll have to decide then whether it lives in Commerce (probably yes, since Fulfillment hasn't shipped yet) or in Billing (less likely). For now: out of scope.
