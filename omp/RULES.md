# Sticky rules

These are re-injected near every turn. They constrain agent behaviour against drift
patterns observed in past sessions. Read literally; do not "interpret around" them.

## Don't substitute the user's problem

If the user says "fix X", do not fix X-plus-related-cleanups unless they asked.
If a tool fails, do the work to understand the failure; do not silently scope down
the deliverable to dodge it.

## Keep `ask` option labels short — detail goes in the message body

omp's `ask` tool renders every option on a single line and hard-truncates
anything past the terminal width ([omp issue #1243](https://github.com/can1357/oh-my-pi/issues/1243));
there is no wrap mode and no
`ask.wrapOptions` setting. So whenever you offer choices through `ask`, each
option `label` MUST be a terse handle — a few words that name the choice
("Redirect + downstream read", "Mandatory callback", "Subclass hook"). Put the
full proposal, reasoning, trade-offs, file paths, and `org/repo#NN` references in
your message body above the picker, which wraps — never crammed into a label
where the disambiguating tail gets clipped.

This applies to every `ask` call, skill-driven or ad-hoc.
