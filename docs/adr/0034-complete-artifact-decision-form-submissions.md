# Complete artifact decision-form submissions

A decision form previously sent feedback without ending its browser review.
After the user selected a terminal Review change action and pressed Submit decisions, the unchanged page looked as though it still required work.
The separate Approve control also duplicated an approve-as-is decision already validated by the report form.

A `review:submit` frame now carries a bounded terminal `completion` value.
A workflow-defined approval decision uses `approve`; every non-approval decision uses `end`.
The review shell sends the decision prompt and terminal action in one request, records feedback before the terminal event, and shows the same completed-review splash screen as its Approve or End review control.
Older artifacts that omit the value fail closed to an unapproved end.

Review change associates every Finding control with its one decision form, including controls rendered outside the form element through the HTML `form` attribute.
Its handler names the exact unmet condition when validation fails.
A repair request ends the current decision round; after repairs materially change the report, the workflow reopens the report for a new round.
A validated approve-as-is submission clears the gate without a second approval click.
