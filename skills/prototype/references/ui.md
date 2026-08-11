# Runnable UI Prototype

Build a throwaway UI inside the host application when integration, real data density, or actual state behavior cannot be judged in standalone `mockups.html`.
If the question is only “What should this look like?”, stop and use `mockup` instead.

## Choose the order

- Run `mockup` first when end-user interface design is the subject or an imperative prerequisite.
- Read and follow the selected mockup when one exists, while treating its code as non-production.
- When UI only presents logic, data exploration, manual processing, or state behavior, answer that primary question first and leave optional mockup work until last.
- Skip mockup when no UI design question exists.

## Prefer the real host

A UI prototype is useful because it meets the real application rather than a blank canvas.
Use the existing page, route, data fetching, parameters, authentication, navigation, component library, styling system, and content density whenever possible.
Replace only the rendered subtree or interaction under investigation.

Create a throwaway route only when the experiment has no plausible existing host.
Follow the project's routing convention and mark the route clearly as a prototype.
Do not invent a new top-level structure.

## Process

### 1. State one question

Write one sentence near the prototype:

> “Does the approved activity timeline remain understandable with real account data and the existing dashboard state flow?”

The question must name the host-application fact that standalone HTML cannot answer.
If it does not, use `mockup` instead.

### 2. Build the smallest integrated experiment

Default to one implementation of the selected design.
Keep the existing data and application state above the experimental subtree.
Use stubs for destructive mutations unless mutation behavior is the question.
Surface the relevant state after every action so the user can see what changed.

Use two or three variants only when the integration question itself compares approaches that cannot be judged independently of the host.
Variants must differ in the behavior or integration strategy under test, not only color or copy.
Do not recreate alternatives that the approved mockup already rejected.

### 3. Add a switcher only when variants exist

When the experiment requires variants, select them with a `?variant=` URL search parameter so each state is shareable and stable across reloads.
Use a small fixed bottom switcher with previous, current, and next controls.
Arrow keys can cycle variants, but must not intercept input, textarea, select, or editable content.
Hide the switcher in production builds so it cannot ship accidentally.

A one-design prototype needs no switcher.

### 4. Hand over the real question

Give the user one command and the exact host route.
Explain what application condition to inspect, such as data density, loading state, permissions, navigation, or interaction latency.
Do not ask them to grade decorative details that belong to the mockup workflow.

### 5. Capture the answer and clean up

Record what the host integration taught the team.
If it invalidates approved UI intent, return to `mockups.html` and review the changed design before production implementation.
If it changes the ubiquitous language or creates a qualifying durable decision, route updates to the applicable context files or ADRs through `model-domain`.

Delete the throwaway route, variants, stubs, and switcher when the question is answered.
Rewrite validated behavior under production constraints and tests rather than promoting prototype or mockup code.

## Anti-patterns

- Building a runnable route for a visual question that standalone `mockups.html` can answer.
- Recreating three visual variants by default after the mockup already selected a design.
- Prototyping against fake sparse data when real density is the reason the prototype exists.
- Wiring variants to destructive production mutations.
- Leaving prototype controls or routes in the production tree.
- Promoting prototype or mockup code directly into production.
