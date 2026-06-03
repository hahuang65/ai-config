# Artifact Review

Shared reference for `prd` and `tasks`. The invoking skill writes the markdown artifact (`prd.md` / `tasks.md`), generates its visual companion (`prd.html` / `tasks.html`), and **opens it in the browser** — *then* runs this review. The visual is **not** rebuilt during the review; it's regenerated once at the end only if the markdown changed. The invoking skill supplies what the user should check, the default feedback channel, and what "advance" means; the loop below is identical for both.

## Protocol

**1. Present and invite feedback.** The markdown is written and its visual is already generated and open in the browser. Present the artifact for review and collect feedback in whichever form fits — the skill picks a default, the user may use either:

- **`//` annotations** — the user drops inline notes anywhere in the markdown, each placed next to whatever it refers to (corrections, additions, scope cuts, questions):

  ```markdown
  ## Some Section

  // also need: handle the revoked-session case
  1. The line this note applies to...

  // drop this — out of scope per the grill session
  7. Something to remove...
  ```

- **Direct questioning** — you ask targeted questions in chat (granularity, coverage, correctness, …) and the user answers in the conversation.

Ask **once**, in a single prompt: invite feedback (annotations or answers) *or* a go-ahead to move on. Make clear there is **no separate "review is done" sign-off** — the user either gives you feedback to address, or confirms.

**2. Feedback given** → address every point (skip none; for `//` annotations, remove each as you resolve it), update the markdown, and re-present **the markdown** — back to step 1. **Do not regenerate the visual during the review** — it's slow and costly, so the markdown is the source of truth across the loop (the open visual may lag). Repeat as long as the user keeps giving feedback.

**3. User confirms** (any affirmative response — no exact phrase required) → if the markdown changed during the review, regenerate the visual once from the final markdown and reopen it; then **advance to the next phase** as the invoking skill describes.

Never advance while the user is still reviewing; never stall for a second confirmation once they confirm.
