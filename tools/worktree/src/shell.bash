# Opt-in directory switching. The executable remains available through command.
_wt_shell() {
    local program=$1
    shift
    if [[ ${1-} != enter && ${1-} != leave ]]; then
        command "$program" "$@"
        return $?
    fi
    local argument target
    for argument in "$@"; do
        case "$argument" in
            --json|--help|-h*)
                command "$program" "$@"
                return $?
                ;;
        esac
    done
    # Keep path newlines by removing a sentinel and only the output delimiter.
    target=$(command "$program" "$@" && builtin printf '.') || return $?
    target=${target%.}
    target=${target%$'\n'}
    builtin cd -- "$target" || return
}
wt() { _wt_shell wt "$@"; }
worktree() { _wt_shell worktree "$@"; }
