#!/usr/bin/env bash
# Claude Code status line aligned with the pi two-line footer.

BLUE=$'\033[94m'
DIM=$'\033[2m'
PURPLE=$'\033[35m'
RED=$'\033[31m'
RESET=$'\033[0m'

input=$(cat)
cwd=$(echo "$input" | jq -r '.cwd')
branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)

input_tokens=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
output_tokens=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
cache_read=$(echo "$input" | jq -r '.context_window.total_cache_read_input_tokens // .context_window.current_usage.cache_read_input_tokens // 0')
cache_write=$(echo "$input" | jq -r '.context_window.total_cache_creation_input_tokens // .context_window.current_usage.cache_creation_input_tokens // 0')
latest_input=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // 0')
latest_cache_read=$(echo "$input" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')
latest_cache_write=$(echo "$input" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
total_cost_usd=$(echo "$input" | jq -r '.cost.total_cost_usd // .context_window.total_cost_usd // 0')
subscription=$(echo "$input" | jq -r '.cost.is_subscription // .model.is_subscription // false')
cost="\$$(printf '%.3f' "$total_cost_usd")"
[ "$subscription" = true ] && cost="$cost (sub)"

model=$(echo "$input" | jq -r '.model.display_name // .model.id // "no-model"')
thinking=$(echo "$input" | jq -r '.thinking_level // .model.thinking_level // empty')
model_status="$model"
[ -n "$thinking" ] && model_status="$model_status • $thinking"

# Claude Code captures the script's output, so tput cannot read the real terminal;
# the documented width source is the COLUMNS environment variable.
terminal_width=$(echo "$input" | jq -r '.terminal_width // empty')
[ -n "$terminal_width" ] || terminal_width="$COLUMNS"
[ -n "$terminal_width" ] || terminal_width=$(tput cols 2>/dev/null)
[ -n "$terminal_width" ] || terminal_width=80
# Claude Code clips each statusline row four columns short of COLUMNS and replaces
# the overflow with an ellipsis (measured on 2.1.236), so render into that budget.
CLAUDE_CLIP_MARGIN=4
terminal_width=$((terminal_width - CLAUDE_CLIP_MARGIN))

display_cwd="${cwd/#"$HOME"/\~}"
location_plain="$display_cwd"
location_colored="${PURPLE}${display_cwd}${RESET}"
if [ -n "$branch" ]; then
  location_plain="${location_plain} (${branch})"
  location_colored="${location_colored} (${BLUE}${branch}${RESET})"
fi

memory_status=$(bun ~/.dotfiles/ai/harnesses/claude/hooks/agentmemory-capture.ts --status "$cwd" "$(echo "$input" | jq -r '.session_id // "unknown"')" 2>/dev/null)
[ -n "$memory_status" ] || memory_status="⚠️ ${RED}agentmemory${RESET} · recall ? · capture ?"
memory_plain="$memory_status"
while [[ "$memory_plain" =~ $'\033'\[[0-9\;]*m ]]; do
  memory_plain=${memory_plain/"${BASH_REMATCH[0]}"/}
done

format_tokens() {
  local count="$1"
  if [ "$count" -lt 1000 ]; then
    printf '%s' "$count"
  elif [ "$count" -lt 10000 ]; then
    awk -v count="$count" 'BEGIN { printf "%.1fk", count / 1000 }'
  elif [ "$count" -lt 1000000 ]; then
    printf '%sk' "$((count / 1000))"
  elif [ "$count" -lt 10000000 ]; then
    awk -v count="$count" 'BEGIN { printf "%.1fM", count / 1000000 }'
  else
    printf '%sM' "$((count / 1000000))"
  fi
}

stats_plain=""
append_stat() {
  [ -n "$stats_plain" ] && stats_plain="$stats_plain "
  stats_plain="$stats_plain$1"
}
[ "$input_tokens" -gt 0 ] && append_stat "↑$(format_tokens "$input_tokens")"
[ "$output_tokens" -gt 0 ] && append_stat "↓$(format_tokens "$output_tokens")"
[ "$cache_read" -gt 0 ] && append_stat "📚$(format_tokens "$cache_read")"
[ "$cache_write" -gt 0 ] && append_stat "💾$(format_tokens "$cache_write")"
latest_prompt=$((latest_input + latest_cache_read + latest_cache_write))
if [ "$latest_prompt" -gt 0 ]; then
  cache_hit=$(awk -v read="$latest_cache_read" -v total="$latest_prompt" 'BEGIN { printf "%.1f", read * 100 / total }')
  append_stat "🎯${cache_hit}%"
fi
append_stat "$cost"
context_percent=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
context_size=$(echo "$input" | jq -r '.context_window.context_window_size // .model.context_window // 0')
if [ -n "$context_percent" ]; then
  append_stat "$(printf '%.1f' "$context_percent")%/$(format_tokens "$context_size") (auto)"
else
  append_stat "?/$(format_tokens "$context_size") (auto)"
fi
experimental=$(echo "$input" | jq -r '.experimental_features_enabled // false')
[ "$experimental" = true ] && append_stat "• xp"
stats_colored="${DIM}${stats_plain}${RESET}"

# The terminal renders display columns (an emoji occupies two), while bash ${#value}
# counts characters, so emoji-bearing lines overflow and Claude Code clips the right
# side. Measure the four segments once with the shared width helper.
side_widths=$(bun ~/.dotfiles/ai/shared/string-width.ts \
  "$location_plain" "$memory_plain" "$stats_plain" "$model_status" 2>/dev/null)
location_width=$(printf '%s\n' "$side_widths" | sed -n 1p)
memory_width=$(printf '%s\n' "$side_widths" | sed -n 2p)
stats_width=$(printf '%s\n' "$side_widths" | sed -n 3p)
model_width=$(printf '%s\n' "$side_widths" | sed -n 4p)

visible_length() {
  local value="$1" width=""
  case "$value" in
    "$location_plain") width="$location_width" ;;
    "$memory_plain") width="$memory_width" ;;
    "$stats_plain") width="$stats_width" ;;
    "$model_status") width="$model_width" ;;
  esac
  printf '%s' "${width:-${#value}}"
}

align_line() {
  local left_plain="$1"
  local left_colored="$2"
  local right_plain="$3"
  local right_colored="$4"
  local left_width right_width maximum_left padding
  left_width=$(visible_length "$left_plain")
  right_width=$(visible_length "$right_plain")
  maximum_left=$((terminal_width - right_width - 1))
  if [ "$left_width" -gt "$maximum_left" ] && [ "$maximum_left" -gt 1 ]; then
    left_plain="${left_plain:0:maximum_left-1}…"
    left_colored="${PURPLE}${left_plain}${RESET}"
    left_width=$(visible_length "$left_plain")
  fi
  padding=$((terminal_width - left_width - right_width))
  [ "$padding" -gt 0 ] || padding=1
  printf '%s%*s%s\n' "$left_colored" "$padding" "" "$right_colored"
}

align_line "$location_plain" "$location_colored" "$memory_plain" "$memory_status"
align_line "$stats_plain" "$stats_colored" "$model_status" "${DIM}${model_status}${RESET}"