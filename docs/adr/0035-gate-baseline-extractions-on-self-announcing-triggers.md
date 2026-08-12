# Gate baseline extractions on self-announcing triggers

ADR-0016 established a small always-on bootstrap (`baseline-prompt.md`) and one shared lazy rulebook (`~/.dotfiles/ai/rules/`).
The bootstrap stays under pressure to shrink further, because every line costs context in every turn of every harness.
A 2026-08-12 review evaluated the remaining baseline bullets for extraction and exposed a failure mode: some rules exist precisely to redirect behavior before the agent would know to look anything up.
A lazy rule whose own content is needed to recognize its load trigger can never fire.
The mise bullet is the clearest example: an agent that has not read the mise rule may reach for `asdf` directly, and no "before invoking a tool" trigger reliably interrupts that.

## Decision

Apply a bootstrap test to every proposal that moves an always-on baseline bullet into the lazy rulebook:

**A bullet may leave the baseline only when its trigger moment is recognizable without the rule's content.**

Ask: would the agent recognize the moment to load this rule if it had never read the rule?

- Action-scoped rules with self-announcing moments usually pass.
  "I am about to open or present an HTML file" is unmistakable regardless of what the rule says.
- Negative constraints ("never activate rbenv, rvm, chruby, asdf, nvm, or pyenv") usually fail.
  Their whole job is to stop an action the agent would otherwise take without pausing.
- Classification gates ("treat a project as A5 only when …") usually fail.
  Knowing to perform the classification check is exactly what the rule teaches, so nothing in the project announces the trigger.

Applications from the originating review:

- HTML routing passed and moved to `rules/html-routing.md`, with the trigger "before opening or presenting an HTML file" in the bootstrap's rulebook list.
- The mise bullet, the A5 classification bullet, and the Orchard usage boundary failed and stay always-on.

## Consequences

- This amends ADR-0016's placement list: HTML routing is now lazy, not always-on.
  The rest of ADR-0016 stands.
- `test/review-artifact-contract.test.ts` asserts the split: the bootstrap owns the HTML-routing load trigger, and `rules/html-routing.md` owns the routing semantics.
- Future extraction proposals apply this test before any edit, which keeps bootstrap-shrinking work from silently disabling the rules it moves.
- The test also explains why the bootstrap cannot shrink below a floor: negative constraints and classification gates are structurally always-on.
