# Separate change validation from architecture review

The final `/build` gate must decide whether a specific change satisfies its intent and is safe to finish, while `review-code` deliberately searches for optional architectural deepening opportunities.
We replaced mandatory build-time `review-code` with `change-review` and retained its architectural analysis and grilling behavior as an optional standalone workflow.
Its former build-only changed-file scope and terminal gate were removed.
This keeps concrete correctness, security, evidence, documentation, and lint Findings in the shipping gate without allowing speculative redesign to block feature completion.
