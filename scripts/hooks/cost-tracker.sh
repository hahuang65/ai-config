#!/usr/bin/env bash
#
# cost-tracker.sh — Log estimated token costs after each Claude response
#
# Registered as a Stop hook in hooks.json. Reads session data from stdin
# and appends a cost record to ~/.claude/metrics/costs.jsonl.
#
set -euo pipefail

METRICS_DIR="$HOME/.claude/metrics"
COSTS_FILE="$METRICS_DIR/costs.jsonl"

mkdir -p "$METRICS_DIR"

# Read stdin (Claude Code passes session JSON on Stop hooks)
INPUT=$(cat)

# Extract token counts — try multiple field paths
INPUT_TOKENS=$(echo "$INPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
usage = data.get('usage', data.get('token_usage', {}))
print(usage.get('input_tokens', 0))
" 2>/dev/null || echo "0")

OUTPUT_TOKENS=$(echo "$INPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
usage = data.get('usage', data.get('token_usage', {}))
print(usage.get('output_tokens', 0))
" 2>/dev/null || echo "0")

# Skip if no tokens recorded
if [ "$INPUT_TOKENS" = "0" ] && [ "$OUTPUT_TOKENS" = "0" ]; then
  exit 0
fi

# Detect model from env or input
MODEL=$(echo "$INPUT" | python3 -c "
import sys, json, os
data = json.load(sys.stdin)
model = data.get('model', os.environ.get('CLAUDE_MODEL', 'unknown'))
print(model)
" 2>/dev/null || echo "${CLAUDE_MODEL:-unknown}")

# Estimate cost (USD per 1M tokens)
COST=$(python3 -c "
model = '$MODEL'
input_tokens = $INPUT_TOKENS
output_tokens = $OUTPUT_TOKENS

# Pricing per 1M tokens (input, output)
pricing = {
    'haiku':  (0.80, 4.00),
    'sonnet': (3.00, 15.00),
    'opus':   (15.00, 75.00),
}

# Match model to tier
tier = 'sonnet'  # default
for key in pricing:
    if key in model.lower():
        tier = key
        break

input_rate, output_rate = pricing[tier]
cost = (input_tokens * input_rate + output_tokens * output_rate) / 1_000_000
print(f'{cost:.6f}')
" 2>/dev/null || echo "0.000000")

# Get session ID if available
SESSION_ID=$(echo "$INPUT" | python3 -c "
import sys, json
data = json.load(sys.stdin)
print(data.get('session_id', 'unknown'))
" 2>/dev/null || echo "unknown")

# Append JSONL record
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
printf '{"timestamp":"%s","session_id":"%s","model":"%s","input_tokens":%s,"output_tokens":%s,"estimated_cost_usd":%s}\n' \
  "$TIMESTAMP" "$SESSION_ID" "$MODEL" "$INPUT_TOKENS" "$OUTPUT_TOKENS" "$COST" >> "$COSTS_FILE"

exit 0
