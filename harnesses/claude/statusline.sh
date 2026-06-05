#!/usr/bin/env bash
#
# Claude Code Status Line
#

# Colors
BLUE=$'\033[94m'
GREEN=$'\033[32m'
PURPLE=$'\033[35m'
RESET=$'\033[0m'

# Read JSON input from stdin
input=$(cat)

# Parse working directory
cwd=$(echo "$input" | jq -r '.cwd')

# Git branch
branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)

# Session ID
session_id=$(echo "$input" | jq -r '.session_id // empty')

# Token usage
total_input=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_output=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
total_used=$((total_input + total_output))

# Cost
total_cost_usd=$(echo "$input" | jq -r '.context_window.total_cost_usd // empty')
cost="\$0.00"
[ -n "$total_cost_usd" ] && cost="\$$(printf '%.2f' "$total_cost_usd")"

# Line 1: Session ID, tokens & cost
line1=""
if [ -n "$session_id" ]; then
  line1="🪪 ${session_id} | "
fi
line1="${line1}🪙 ${total_used} | 💰 ${GREEN}${cost}${RESET}"

# Line 2: Git branch & working directory
display_cwd="${cwd/#"$HOME"/\~}"
line2=""
if [ -n "$branch" ]; then
  line2="${BLUE} ${branch}${RESET} | "
fi
line2="${line2}${PURPLE}${display_cwd}${RESET}"

echo "${line1}"
echo "${line2}"
