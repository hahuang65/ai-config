# Session Recaps

Use this protocol for an interim recap after a decision round, before the next question, or when the session pauses.
A recap transfers context to the reader.
It is not a set of shorthand notes.
It must make sense to a person who did not read the earlier conversation.

## Required Structure

Use these sections in this order:

**What we decided**

- State one decision per bullet.
- Start with **Decision:** and write the decision as a complete sentence.
- Follow with **Meaning:** and explain the practical effect in a complete sentence.
- Include an identifier such as `Q2a` or `D-001` only as supporting information, not as the explanation.

**What remains open**

- List only questions that still need an answer.
- Explain why an answer is needed when that reason is not clear.

**What happens next**

- Name the next question or action.
- State what you need from the user.

Omit a section only when it has no content.
Do not mix completed decisions with open questions.

## Plain-Language Check

Before sending the recap, check each point:

- Can a reader understand the recap without the earlier conversation?
- Does every bullet contain a complete sentence that states an action, decision, or conclusion?
- Does each decision have its own bullet?
- Does each project-specific term have a short explanation at its first use in this recap?
- Did you replace shorthand such as “input in,” “handoff out,” “inventory stands,” or a list of unexplained nouns?
- Did you remove dense parentheses and split long chains of clauses?

Use the project's ubiquitous language from the selected context documentation, but do not assume that a canonical term is familiar to the reader.
Explain the term each time a new recap must stand alone.
Do not invent a definition when the source material does not define the term.
Instead, say that the term still needs a definition or describe the decision without that term.

## Example

This example is fictional.
Its definitions show the required form and do not define terms for a real project.

### Bad

> Q1 settled — interface inventory stands: jobs in, operator control in, review handoff out, observability out.
> `pause.lock` interlock shared; reservation ledger internal.

This text uses fragments and unexplained terms.
The reader cannot tell what each component does.

### Better

> **What we decided**
>
> - **Decision:** The service receives jobs from the scheduler.
>   **Meaning:** The scheduler sends each job that the service must process.
> - **Decision:** An operator can pause or resume the service from the administration page.
>   **Meaning:** The operator does not need to change a file or restart the service.
> - **Decision:** The service stops accepting jobs while `pause.lock` exists.
>   **Meaning:** In this example, `pause.lock` is a shared file that pauses new work.
> - **Decision:** The reservation ledger remains private to the service.
>   **Meaning:** In this example, the reservation ledger records which jobs the service has reserved; other components do not read it.
>
> **What remains open**
>
> - We have not decided how the service sends a failed job for human review.
>
> **What happens next**
>
> - We will decide how the service sends a failed job and how the reviewer returns a decision.

The better version preserves the project terms, defines them, and states the effect of each decision.
