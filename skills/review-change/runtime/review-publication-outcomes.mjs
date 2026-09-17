const ERROR_OUTCOMES = {
  confirmation_expired: ["Confirmation expired.", "Nothing was posted because the fifteen-minute confirmation expired.", "Return to the still-open report and request a new confirmation."],
  duplicate_http_header: ["The browser request contained a duplicate header.", "No comments were posted because duplicate HTTP headers are unsafe.", "Return to the report and request publication again."],
  forbidden_host: ["The local publication address was rejected.", "No comments were posted because the request used the wrong local host.", "Open the original report and try again without changing its address."],
  github_actor_changed: ["The GitHub account changed.", "No comments were posted because a different GitHub account is active.", "Sign in to GitHub CLI with the account named in the report, then try again."],
  incomplete_http_request: ["The browser request was incomplete.", "No comments were posted because the local publisher did not receive the complete request.", "Return to the report and request publication again."],
  invalid_confirmation_token: ["The confirmation is invalid.", "Nothing was posted because the confirmation could not be verified.", "Return to the report and request a new confirmation."],
  invalid_content_length: ["The browser request size was invalid.", "No comments were posted because the request body size could not be verified.", "Return to the report and request publication again."],
  invalid_finding_selection: ["The Finding selection is invalid.", "No comments were posted because the selected Findings do not match this report.", "Return to the report and select the Findings again."],
  invalid_http_framing: ["The browser request contained extra data.", "No comments were posted because the local request body did not match its declared size.", "Return to the report and request publication again."],
  invalid_http_header: ["The browser request contained an invalid header.", "No comments were posted because the local request headers could not be checked safely.", "Return to the report and request publication again."],
  invalid_http_request: ["The browser request is invalid.", "No comments were posted because the local publisher could not safely read the request.", "Return to the report and request publication again."],
  invalid_http_request_line: ["The browser request line is invalid.", "No comments were posted because the local publisher accepts only its fixed POST request.", "Return to the report and request publication again."],
  invalid_inline_location: ["A Finding no longer matches the pull request.", "No comments were posted because a selected Finding is not in the reviewed changes.", "Run Review change again. The Finding will not be moved."],
  inline_location_unverifiable: ["GitHub could not verify a Finding location.", "No comments were posted because GitHub did not provide a complete pull-request diff.", "Check GitHub status, then try again from the report."],
  invalid_publication: ["The review cannot be posted.", "No comments were posted because the publication request failed validation.", "Run Review change again, then use the new report."],
  invalid_publication_claims: ["The report data is invalid.", "No comments were posted because the signed report contains invalid publication data.", "Run Review change again, then use the new report."],
  invalid_publication_endpoint: ["The publication address is invalid.", "No comments were posted because the request did not use a supported local endpoint.", "Return to the original report and request publication again."],
  invalid_publication_request: ["The publication form is invalid.", "No comments were posted because the submitted form contains missing, duplicate, or unknown fields.", "Return to the report and request publication again."],
  invalid_publication_token: ["The report could not be verified.", "No comments were posted because the signed report data is invalid.", "Run Review change again, then use the new report."],
  not_found: ["The publication endpoint was not found.", "No comments were posted because the local request used an unknown method or path.", "Return to the original report and request publication again."],
  os_confirmation_denied: ["Publication was not approved.", "Nothing was posted because you denied the operating-system confirmation.", "Return to the report if you want to try again."],
  os_confirmation_dismissed: ["Confirmation was dismissed.", "Nothing was posted because the operating-system confirmation was closed.", "Return to the report if you want to try again."],
  os_confirmation_failed: ["Operating-system confirmation failed.", "Nothing was posted because the required system confirmation did not complete.", "Check your desktop session, then try again."],
  os_confirmation_invalid_response: ["The confirmation response was invalid.", "Nothing was posted because explicit operating-system approval could not be verified.", "Return to the report and request publication again."],
  os_confirmation_timeout: ["Confirmation timed out.", "Nothing was posted because the operating-system confirmation was not answered in time.", "Return to the report and request publication again."],
  os_confirmation_unavailable: ["Operating-system confirmation is unavailable.", "Nothing was posted because the publisher could not show the required system confirmation.", "Repair the Review publication installation, then try again."],
  provider_authentication_failed: ["GitHub sign-in failed.", "No comments were posted because GitHub could not verify your account.", "Sign in with GitHub CLI, then try again."],
  provider_failed: ["GitHub could not complete the request.", "No comments were posted because GitHub did not complete the required check.", "Check your connection and GitHub status, then try again."],
  provider_invalid_response: ["GitHub returned an unreadable response.", "No comments were posted because the GitHub response could not be checked safely.", "Check GitHub status, then run Review change again."],
  provider_output_limit: ["GitHub returned too much data.", "No comments were posted because the GitHub response exceeded the safe limit.", "Check GitHub status, then try again."],
  provider_permission_denied: ["GitHub refused the review.", "No comments were posted because the active account cannot review this pull request.", "Ask for pull-request review permission, then try again."],
  provider_rate_limited: ["GitHub is temporarily limiting requests.", "No comments were posted by this attempt.", "Wait for the GitHub limit to reset, then try again."],
  provider_timeout: ["GitHub did not respond in time.", "No comments were posted because GitHub did not complete the required check in time.", "Check your connection and GitHub status, then try again."],
  provider_unavailable: ["GitHub CLI is unavailable.", "No comments were posted because the required GitHub command could not start.", "Install or repair GitHub CLI, then try again."],
  publisher_configuration_invalid: ["Review publication is not configured safely.", "No comments were posted because the managed worker configuration could not be validated.", "Repair the Review publication installation, then try again."],
  publisher_initialization_failed: ["Review publication could not start.", "No comments were posted because the local worker could not initialize safely.", "Repair the Review publication installation, then try again."],
  publisher_signing_key_unavailable: ["Review publication signing is unavailable.", "No comments were posted because the local signing key could not be validated.", "Repair the Review publication installation, then try again."],
  publication_outcome_unknown: ["GitHub did not confirm the result.", "The review may have been posted because the create-review request might have reached GitHub.", "Submit this same confirmed review again."],
  publication_reconciliation_conflict: ["This report conflicts with an existing review.", "No new comments were posted because a different review already uses this report identity.", "Inspect the pull request, then run Review change again if another review is needed."],
  pull_request_scope_changed: ["The pull request changed.", "No comments were posted because the reviewed commits no longer match.", "Run Review change again. Comments will not be moved to different lines."],
  publisher_busy: ["This review is already being posted.", "No comments were posted by this attempt.", "Wait for this report to finish, then try again."],
  request_body_too_large: ["The browser request body is too large.", "No comments were posted because the request exceeded the safe body limit.", "Run Review change again with fewer or shorter Findings."],
  request_headers_too_large: ["The browser request headers are too large.", "No comments were posted because the request exceeded the safe header limit.", "Return to the report and request publication again."],
  request_timeout: ["The publication request took too long.", "No comments were posted because the request did not finish in time.", "Run Review change again, then use the new report."],
  request_too_large: ["The publication request is too large.", "No comments were posted because the request exceeded the safe size limit.", "Run Review change again with fewer or shorter Findings."],
  unsupported_media_type: ["The publication form type is unsupported.", "No comments were posted because the local request was not a browser form submission.", "Return to the original report and request publication again."],
  unsupported_publication_protocol: ["This report uses an unsupported publication protocol.", "No comments were posted because this publisher cannot safely read the report.", "Update the Review publication installation, then run Review change again."],
  unsupported_transfer_encoding: ["The browser request encoding is unsupported.", "No comments were posted because chunked local requests are not accepted.", "Return to the report and request publication again."],
};

export const PUBLICATION_ERROR_OUTCOMES = Object.freeze(Object.keys(ERROR_OUTCOMES));

export const PRE_CREATE_REJECTION_BRANCHES = Object.freeze({
  http: Object.freeze([
    "duplicate_http_header", "incomplete_http_request", "invalid_content_length", "invalid_http_framing",
    "invalid_http_header", "invalid_http_request", "invalid_http_request_line", "invalid_publication_endpoint",
    "request_body_too_large", "request_headers_too_large", "request_timeout", "request_too_large",
    "unsupported_transfer_encoding",
  ]),
  server: Object.freeze([
    "confirmation_expired", "forbidden_host", "github_actor_changed", "invalid_confirmation_token",
    "inline_location_unverifiable", "invalid_finding_selection", "invalid_inline_location", "invalid_publication", "invalid_publication_claims",
    "invalid_publication_request", "invalid_publication_token", "not_found", "os_confirmation_denied", "os_confirmation_dismissed",
    "os_confirmation_failed", "os_confirmation_invalid_response", "os_confirmation_timeout",
    "os_confirmation_unavailable", "pull_request_scope_changed", "publisher_busy", "request_too_large",
    "unsupported_media_type", "unsupported_publication_protocol",
  ]),
  provider: Object.freeze([
    "github_actor_changed", "inline_location_unverifiable", "invalid_inline_location", "provider_authentication_failed", "provider_failed",
    "provider_invalid_response", "provider_output_limit", "provider_permission_denied", "provider_rate_limited",
    "provider_timeout", "provider_unavailable", "publication_reconciliation_conflict", "pull_request_scope_changed",
    "request_timeout",
  ]),
});

export const POST_CREATE_OUTCOME_BRANCHES = Object.freeze(["publication_outcome_unknown"]);

export function publicationErrorContent(code) {
  const outcome = ERROR_OUTCOMES[code] ?? ERROR_OUTCOMES.invalid_publication;
  return { heading: outcome[0], impact: outcome[1], action: outcome[2] };
}
