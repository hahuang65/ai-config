# Opt-in directory switching. The executable remains available through command.
_wt_shell() {
    local program=$1
    shift
    if [[ ${1-} != enter ]]; then
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
    target=$(command "$program" "$@") || return $?
    builtin cd -- "$target" || return
}
wt() { _wt_shell wt "$@"; }
worktree() { _wt_shell worktree "$@"; }
