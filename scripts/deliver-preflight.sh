#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf 'deliver-preflight: %s\n' "$1" >&2
  exit 1
}

canonicalize_directory() {
  [ -d "$1" ] || fail "directory does not exist: $1"
  (cd "$1" && pwd -P)
}

emit() {
  case "$2" in
    *$'\n'* | *$'\r'*) fail "output value for $1 contains a line break" ;;
  esac
  printf '%s=%s\n' "$1" "$2"
}

keep=false
explicit_intent=false
unknown_option=false
options_ended=false
for argument in "$@"; do
  if [ "$options_ended" = true ]; then
    explicit_intent=true
    continue
  fi

  case "$argument" in
    --keep) keep=true ;;
    --) options_ended=true ;;
    --*) unknown_option=true ;;
    *) explicit_intent=true ;;
  esac
done

if [ "$explicit_intent" = true ]; then
  emit delivery managed
  emit reason explicit-intent
  emit keep "$keep"
  exit 0
fi

root=$(git rev-parse --show-toplevel 2>/dev/null) || fail "current directory is not inside a Git checkout"
canonical_root=$(canonicalize_directory "$root")

if [ -d "$HOME/.orchard" ]; then
  canonical_orchard_root=$(canonicalize_directory "$HOME/.orchard")
  case "$canonical_root" in
    "$canonical_orchard_root" | "$canonical_orchard_root"/*)
      emit delivery managed
      emit reason orchard-root
      emit keep "$keep"
      exit 0
      ;;
  esac
fi

[ "$unknown_option" = false ] || fail "ordinary delivery received an unsupported option"

absolute_git_directory=$(git rev-parse --absolute-git-dir 2>/dev/null) || fail "cannot resolve the absolute Git directory"
canonical_git_directory=$(canonicalize_directory "$absolute_git_directory")
common_git_directory=$(git rev-parse --git-common-dir 2>/dev/null) || fail "cannot resolve the common Git directory"
case "$common_git_directory" in
  /*) ;;
  *) common_git_directory="$(pwd -P)/$common_git_directory" ;;
esac
canonical_common_directory=$(canonicalize_directory "$common_git_directory")

[ "$canonical_git_directory" = "$canonical_common_directory" ] || fail "ordinary delivery cannot run from a linked worktree"

first_worktree=$(git worktree list --porcelain | awk '/^worktree / { sub(/^worktree /, ""); print; exit }')
[ -n "$first_worktree" ] || fail "Git did not report a primary worktree"
canonical_first_worktree=$(canonicalize_directory "$first_worktree")
primary=standard

if [ "$canonical_root" != "$canonical_first_worktree" ]; then
  superproject=$(git rev-parse --show-superproject-working-tree 2>/dev/null || true)
  [ -n "$superproject" ] || fail "current Git root does not match the primary worktree"
  canonical_superproject=$(canonicalize_directory "$superproject")
  [ -n "$canonical_superproject" ] || fail "cannot resolve the superproject"
  [ "$canonical_first_worktree" = "$canonical_common_directory" ] || fail "absorbed submodule metadata does not match the primary worktree"

  core_worktree=$(git config --get core.worktree 2>/dev/null || true)
  [ -n "$core_worktree" ] || fail "absorbed submodule has no core.worktree"
  case "$core_worktree" in
    /*) resolved_core_worktree="$core_worktree" ;;
    *) resolved_core_worktree="$canonical_common_directory/$core_worktree" ;;
  esac
  canonical_core_worktree=$(canonicalize_directory "$resolved_core_worktree")
  [ "$canonical_core_worktree" = "$canonical_root" ] || fail "absorbed submodule core.worktree does not resolve to the current Git root"
  primary=absorbed-submodule
fi

branch=$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)
[ -n "$branch" ] || fail "ordinary delivery requires a named feature branch"

origin_head=$(git symbolic-ref --quiet refs/remotes/origin/HEAD 2>/dev/null || true)
if [ -n "$origin_head" ]; then
  case "$origin_head" in
    refs/remotes/origin/*) trunk=${origin_head#refs/remotes/origin/} ;;
    *) fail "origin/HEAD does not name an origin branch" ;;
  esac
  git show-ref --verify --quiet "refs/heads/$trunk" || fail "origin/HEAD does not name an existing local trunk branch"
else
  trunk=
  trunk_candidates=0
  for candidate in main master; do
    if git show-ref --verify --quiet "refs/heads/$candidate"; then
      trunk=$candidate
      trunk_candidates=$((trunk_candidates + 1))
    fi
  done
  [ "$trunk_candidates" -eq 1 ] || fail "trunk is ambiguous or unavailable"
fi

[ "$branch" != "$trunk" ] || fail "ordinary delivery requires a feature branch, not trunk"
if git worktree list --porcelain | grep -Fqx "branch refs/heads/$trunk"; then
  fail "trunk is already checked out"
fi

status=$(git status --short)
dirty=false
[ -z "$status" ] || dirty=true
feature_tip=$(git rev-parse HEAD)

project_family_scope=none
project_family_origin=none
project_family_value=none
project_family_record=$(git config --show-scope --show-origin --get ai.projectFamily 2>/dev/null || true)
if [ -n "$project_family_record" ]; then
  project_family_scope=${project_family_record%%$'\t'*}
  project_family_rest=${project_family_record#*$'\t'}
  project_family_origin=${project_family_rest%%$'\t'*}
  project_family_value=${project_family_rest#*$'\t'}
fi

a5=false
case "$project_family_scope:$project_family_value" in
  global:a5 | system:a5) a5=true ;;
esac

pr_alias=false
if git config --global --get alias.pr >/dev/null 2>&1; then
  pr_alias=true
fi

emit delivery ordinary
emit primary "$primary"
emit root "$canonical_root"
emit branch "$branch"
emit trunk "$trunk"
emit feature_tip "$feature_tip"
emit dirty "$dirty"
emit keep "$keep"
emit project_family_scope "$project_family_scope"
emit project_family_origin "$project_family_origin"
emit project_family_value "$project_family_value"
emit a5 "$a5"
emit pr_alias "$pr_alias"
