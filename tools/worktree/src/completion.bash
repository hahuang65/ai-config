_wt_complete() {
    local candidate
    COMPREPLY=()
    while IFS= read -r candidate; do
        COMPREPLY+=("$candidate")
    done < <("${COMP_WORDS[0]}" __complete "$COMP_CWORD" "${COMP_WORDS[@]}" 2>/dev/null)
}
complete -F _wt_complete wt worktree
