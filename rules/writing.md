---
description: Read before writing replies, documents, comments, or commit messages.
---

# Write clear technical English

Use practical defaults inspired by Simplified Technical English (STE).
This is guidance, not automatic enforcement or a claim of ASD-STE100 compliance.
Preserve technical meaning when a default does not fit.
Follow explicit user requirements and project conventions.

## Where to apply this rule

Apply it to new replies, documents, code comments, and commit messages.
Check prose, not executable code or literal data.
Do not rename identifiers or rewrite commands, paths, URLs, API names, quoted text, or historical records to satisfy a writing preference.
Explain an unfamiliar term around its exact spelling rather than changing the term.
Do not rewrite existing material unless the task includes that work.

## Choose words and verbs

- Use familiar, precise words. Prefer “use” to “utilize” and “start” to “spin up” when the meaning matches.
- Use one term consistently for one concept. Keep documented technical terms and explain unfamiliar ones on first use.
- Name who or what acts. Prefer active voice for instructions. Passive voice can help when the actor is unknown or irrelevant.
- Prefer simple tenses and direct verbs. Keep progressive or perfect tenses when they convey necessary timing or state.
- Prefer full forms such as “do not” over contractions. Preserve quotations and an explicitly requested conversational voice.
- Replace semicolons with separate sentences when the clauses stand alone. Keep punctuation that is part of literal text.
- Remove filler such as “it is important to note” and unsupported promotional claims such as “seamless” or “robust”.

A word is not forbidden in every context.
For example, “robust estimator” can be a precise technical term.
Keep genuine qualifications such as “may fail” or “not yet verified”.
Removing filler must not turn uncertainty into a promise.

## Keep sentences and paragraphs focused

Give each sentence one main idea.
Aim for about 20 words in instructions and 25 in descriptions.
These are editing targets, not hard gates.
Split a dense sentence when the result keeps the same conditions and meaning.
Do not remove needed context just to shorten it.

Prefer short explanatory paragraphs of about three sentences.
Consider splitting paragraphs longer than six sentences at a natural change of topic.
Use bullets for distinct items and numbered lists for ordered steps.
Do not turn every sentence into a bullet or separate related facts merely to meet a count.

## Help the reader understand

Write for a technically capable reader who may not know the project's internals.
Lead with the answer, change, or problem and explain its practical effect.
Introduce details in the order the reader needs them.
Give the next action when one is needed.
Introduce implementation details, identifiers, paths, or commands after the explanation when that order helps.

For documents, introduce the problem, proposed approach, and practical effect where useful.
Do not force one outline onto every document.
Make headings answer the reader's question or state the section's conclusion.
Use concrete examples when behavior would otherwise remain abstract.
Prefer clarity over brevity, without repeating the same explanation.

## Check the draft once

Before sending a reply or writing prose, read the draft for unclear actors, wordy phrases, tense choices, and run-on sentences.
Check that the reader can identify what happened, why it matters, and what to do next when action is needed.
Revise without dropping conditions, uncertainty, or evidence.
Do not invent facts, measurements, verification, or approval to make the explanation sound definite.

These defaults adapt the writing goals of [agent-ste 0.5.2](https://github.com/ctotheameron/agent-ste/blob/7672eb68144f2cb188ae0df9e4a9eab8f9a6ce3e/src/ste/rule.gleam).
They do not install its linter, copy the full ASD dictionary, or add tool gates or automatic rewrites.
