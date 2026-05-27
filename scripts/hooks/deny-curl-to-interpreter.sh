#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash, if: Bash(curl *)).
# Blocks auto-approval when a curl command pipes or chains its output
# into an interpreter (sh, bash, python, node, ruby, etc.). Replaces
# the brittle literal-string Bash(curl * | sh*) deny rules with a
# single regex covering pipe-to-interp, chain-to-interp (&& ; ||),
# and no-space pipe shapes.
#
# Decision is "ask" (not "deny") so the user can still approve a
# false-positive at the permission prompt instead of being hard-blocked.

cmd=$(jq -r '.tool_input.command' 2>/dev/null || true)
[[ -n "$cmd" && "$cmd" == *curl* ]] || exit 0

INTERPS='sh|bash|zsh|fish|ksh|dash|python[23]?|node|nodejs|deno|bun|ruby|perl|php|lua|osascript|eval|sudo'

if printf '%s' "$cmd" | grep -qE "curl.*(\\||&&|;)[[:space:]]*($INTERPS)([[:space:]]|\$|/)"; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"curl output appears to reach an interpreter (pipe or && / ; / || chain). Auto-approval refused; review the command before running."}}
JSON
fi

exit 0
