#!/bin/bash
# Package installation. jq processes data; this script owns all effects.
# jq program variables must remain quoted, never interpolated by Bash.
# shellcheck disable=SC2016
set -euo pipefail
umask 077

usage() {
  printf '%s\n' 'Usage: install.sh [-h|--help]' \
    'Run mise install, then mise exec -- make build in this checkout, then install resources into HOME.' \
    'Requires mise, jq, GNU coreutils, make, Bash, iconv, and find; provisioning may access the network.' \
    'Mise provisions tools from active configuration. Use make build alone to build without installing.' \
    'A live home requires separate approval. Interrupted transactions require inspection.'
}
fail() { printf 'install.sh: %s\n' "$*" >&2; return 1; }
present() { [[ -e $1 || -L $1 ]]; }
json() { jq -L "$root/tools/install" "$@"; }

preflight() {
  command -v jq >/dev/null 2>&1 || { fail 'jq is required. Install jq, then retry. Nothing was built or installed.'; return 1; }
  local tool
  for tool in mv stat dd sync head readlink; do
    case "$("$tool" --version 2>/dev/null)" in
      *'(GNU coreutils)'*|*'(coreutils)'*) ;;
      *) fail "GNU coreutils ($tool) is required on PATH. Nothing was built or installed."; return 1 ;;
    esac
  done
  for tool in make iconv find mise; do
    command -v "$tool" >/dev/null 2>&1 || { fail "$tool is required. Nothing was built or installed."; return 1; }
  done
}

parents() {
  local path=$1
  while [[ $path != / ]]; do
    if present "$path" && { [[ -L $path ]] || [[ ! -d $path ]]; }; then
      fail "Refusing redirected or non-directory parent: $path"; return 1
    fi
    path=${path%/*}; [[ -n $path ]] || path=/
  done
}

regular() {
  local path=$1 limit=$2 metadata
  [[ -f $path && ! -L $path ]] || { fail "Expected a regular, non-symlink file: $path"; return 1; }
  metadata=$(stat -c '%h %s' -- "$path") || return 1
  [[ ( ${3:-single} == generated || ${metadata%% *} == 1 ) && ${metadata#* } -le $limit ]] \
    || { fail "Hard-linked or oversized file: $path"; return 1; }
}

snapshot() {
  local path=$1 destination=$2
  parents "${path%/*}" || return 1
  KIND=missing MODE=600
  if ! present "$path"; then printf '{}' > "$destination"; return; fi
  regular "$path" 16777216 || return 1
  MODE=$(stat -c '%a' -- "$path") || return 1
  printf -v MODE '%03o' "$((8#$MODE & 0777))"
  dd if="$path" of="$destination" iflag=nonblock,nofollow,count_bytes count=16777217 status=none 2>/dev/null || return 1
  regular "$path" 16777216 && regular "$destination" 16777216 || return 1
  KIND='file'
}

check_json() {
  iconv -f UTF-8 -t UTF-8 "$1" >/dev/null 2>&1 || { fail 'Invalid UTF-8 JSON document'; return 1; }
  json -Rse 'include "settings"; decode_document | .t == "object"' "$1" >/dev/null 2>&1 \
    || { fail 'Invalid JSON object, duplicate key, or document limit'; return 1; }
}

check_record() {
  check_json "$1" || return 1
  json -e 'include "manifest"; record | true' "$1" >/dev/null 2>&1 \
    || { fail 'Invalid installation ownership declaration'; return 1; }
  json -Rse 'include "settings"; decode_document | .v.settings // {t:"array",v:[]}
    | claims | [validate_claims] | true' "$1" >/dev/null 2>&1 \
    || { fail 'Duplicate or overlapping settings ownership'; return 1; }
}

resource_tree() {
  local path=$1 entry depth count=0
  parents "${path%/*}" || return 1
  if [[ -f $path && ! -L $path ]]; then return 0; fi
  find "$path" -maxdepth 129 -print0 2>/dev/null | head -z -n 100001 > "$work/tree" \
    || { fail 'Cannot inspect bounded package resource tree'; return 1; }
  while IFS= read -r -d '' entry; do
    count=$((count + 1)); depth=${entry#"$path"}; depth=${depth//[^\/]/}
    [[ $count -le 100000 && ${#depth} -le 128 && ! -L $entry && ( -f $entry || -d $entry ) ]] \
      || { fail 'Package resource is redirected, special, too large, or too deep'; return 1; }
  done < "$work/tree"
  [[ $count -gt 0 ]]
}

support_metadata() {
  local path metadata='' index=0
  local -a resources=()
  while IFS= read -r -d '' path; do
    path="$root/$path"; parents "${path%/*}" || return 1
    [[ -f $path && ! -L $path ]] || { fail "Expected a regular, non-symlink file: $path"; return 1; }
    resources[${#resources[@]}]=$path
  done < "$work/support"
  [[ ${#resources[@]} -gt 0 ]] || return 0
  stat --printf '%f %h %s\0' -- "${resources[@]}" > "$work/support-metadata" || return 1
  while IFS= read -r -d '' metadata; do
    [[ $index -lt ${#resources[@]} ]] || { fail 'Package support metadata count mismatch'; return 1; }
    [[ $metadata =~ ^([[:xdigit:]]+)\ (1)\ ([0-9]+)$ ]] \
      && (( (16#${BASH_REMATCH[1]} & 0170000) == 0100000 )) \
      && [[ ${BASH_REMATCH[3]} -le 16777216 ]] \
      || { fail "Hard-linked, non-regular, or oversized support file: ${resources[index]}"; return 1; }
    index=$((index + 1))
  done < "$work/support-metadata"
  [[ $index -eq ${#resources[@]} && -z $metadata ]] \
    || { fail 'Incomplete package support metadata'; return 1; }
}

package_files() {
  local path name absolute plugin="$root/harnesses/claude/plugins/ai-local-lsp"
  json -nj 'include "manifest"; support_files - ([public_tools[]] + private_tools) | unique[] | ., "\u0000"' > "$work/support"
  support_metadata
  json -nj 'include "manifest"; ([public_tools[]] + private_tools) | unique[] | ., "\u0000"' > "$work/tools"
  # Cargo may hard-link release binaries to hashed artifacts; only catalogue tools qualify.
  while IFS= read -r -d '' path; do
    absolute="$root/$path"; parents "${absolute%/*}"; regular "$absolute" 16777216 generated
    [[ -x $absolute ]] || { fail "Tool is not executable: $path"; return 1; }
  done < "$work/tools"
  json -nr 'include "manifest"; skills[]' > "$work/skills"
  while IFS= read -r name; do
    path="$root/skills/$name/SKILL.md"; regular "$path" 65536
    iconv -f UTF-8 -t UTF-8 "$path" >/dev/null 2>&1
    json -Rse --arg name "$name" 'capture("\\A---\\n(?<header>.*?)\\n---\\n(?<body>.*)\\z"; "m")
      | (.header | split("\n")) as $lines
      | [$lines[] | select(startswith("name: "))] == ["name: " + $name]
        and ([$lines[] | select(startswith("description: ")) | .[13:]] | length == 1
          and all(.[]; test("\\S") and length <= 1024)) and (.body | test("\\S"))' "$path" >/dev/null 2>&1 \
      || { fail "Invalid required skill: $name"; return 1; }
  done < "$work/skills"
  find "$plugin" -mindepth 1 ! -path "$plugin/.claude-plugin" ! -path "$plugin/.claude-plugin/plugin.json" -print > "$work/plugin-extra"
  [[ ! -s $work/plugin-extra ]] || { fail 'Local LSP plugin contains extra resources'; return 1; }
  snapshot "$plugin/.claude-plugin/plugin.json" "$work/plugin"; check_json "$work/plugin"
  json -ne --slurpfile actual "$work/plugin" --slurpfile expected "$root/tools/install/lsp-plugin.json" \
    '$actual == $expected' >/dev/null || { fail 'Local LSP plugin differs from reviewed definition'; return 1; }
}

prepare() {
  local target
  regular "$root/manifest.json" 1048576
  snapshot "$root/manifest.json" "$work/manifest"; check_json "$work/manifest"
  json -Rsr --arg root "$root" 'include "settings"; decode_document
    | if .v.version.v != "2" or .v.source.t != "string" or (.v.source.v != "." and .v.source.v != $root)
      then error("Package source or version mismatch") else .v.source = {t:"string",v:$root} end
    | encode_document' "$work/manifest" > "$work/desired" 2>/dev/null \
    || { fail 'Package source or version does not match this installer'; return 1; }
  check_record "$work/desired"
  json -e --slurpfile permissions "$root/tools/install/permissions.json" \
    'include "manifest"; native_package($permissions[0]) | true' "$work/desired" >/dev/null 2>&1 \
    || { fail 'Package catalogue, harness boundary, or safety settings are invalid'; return 1; }
  json -j '.links | map(.target) | unique[] | ., "\u0000"' "$work/desired" > "$work/targets"
  while IFS= read -r -d '' target; do resource_tree "$root/$target"; done < "$work/targets"
  package_files
}

read_link() { IFS= read -r -d '' LINK < <(readlink -z -- "$1"); }

add_action() {
  local index=${#destinations[@]}
  destinations[index]=$1; before_kind[index]=$2; before_value[index]=$3
  after_kind[index]=$4; after_value[index]=$5; modes[index]=$6; new_modes[index]=${7:-$6}
  printf '%s\0' "$@" >> "$work/journal"
}

plan_links() {
  local destination previous desired actual path
  json -j --slurpfile previous "$work/previous" 'include "manifest"; link_plan($previous[0])' \
    "$work/desired" > "$work/link-plan" 2>/dev/null || { fail 'Overlapping link destinations'; return 1; }
  while IFS= read -r -d '' destination && IFS= read -r -d '' previous && IFS= read -r -d '' desired; do
    path="$HOME/$destination"; parents "${path%/*}"
    [[ $path != "$root" && $path != "$root/"* ]] || { fail 'Source contains an installation destination'; return 1; }
    actual=''
    if present "$path"; then
      if [[ ! -L $path ]] || ! read_link "$path"; then
        fail "Refusing an unrelated destination: $destination"; return 1
      fi
      actual=$LINK
      [[ -n $previous && $actual == "$previous" ]] || { fail "Unowned or modified link: $destination"; return 1; }
    fi
    [[ $desired != "$path" && $desired != "$path/"* ]] || { fail 'Resource links to itself'; return 1; }
    if [[ $actual != "$desired" ]]; then
      add_action "$path" "${actual:+link}" "$actual" "${desired:+link}" "$desired" 600
    fi
  done < "$work/link-plan"
}

plan_settings() {
  local destination path index before
  json -jr --slurpfile previous "$work/previous" \
    '[(.settings // [])[].destination, ($previous[0].settings // [])[].destination] | unique[] | ., "\u0000"' \
    "$work/desired" > "$work/settings-plan"
  while IFS= read -r -d '' destination; do
    path="$HOME/$destination"; index=${#destinations[@]}
    [[ $path != "$root" && $path != "$root/"* ]] || { fail 'Source contains a settings destination'; return 1; }
    before="$work/before-$index"; snapshot "$path" "$before"; check_json "$before"
    json -Rsj --rawfile previous "$work/previous" --rawfile desired "$work/desired" --arg destination "$destination" \
      'include "settings"; plan_settings($previous; $desired; $destination)' "$before" > "$work/after-$index" 2>/dev/null \
      || { fail "Unowned, modified, duplicated, or incompatible settings: $destination"; return 1; }
    if ! cmp -s "$before" "$work/after-$index"; then
      add_action "$path" "$KIND" "$before" file "$work/after-$index" "$MODE"
    fi
  done < "$work/settings-plan"
}

matches() {
  local path=$1 kind=$2 value=$3 mode=$4
  parents "${path%/*}" || return 1
  case "$kind" in
    ''|missing) ! present "$path" ;;
    link) [[ -L $path ]] && read_link "$path" && [[ $LINK == "$value" ]] ;;
    file) snapshot "$path" "$work/check" && [[ $KIND == file && $MODE == "$mode" ]] && cmp -s "$value" "$work/check" ;;
    *) return 1 ;;
  esac
}

stage_matches() {
  local index=$1 path=${stages[$1]} identity
  parents "$path" || return 1
  identity=$(stat -c '%d:%i' -- "$path") || return 1
  [[ $identity == "${stage_ids[index]}" ]]
}

stage_for_parent() {
  local parent=$1 index
  for ((index=0; index<${#stages[@]}; index++)); do
    if [[ ${stages[index]%/*} == "$parent" ]]; then
      stage_matches "$index" || { fail 'Staging directory changed during installation'; return 1; }
      STAGE=${stages[index]}
      return 0
    fi
  done
  STAGE=$(mktemp -d "$parent/.ai-config-XXXXXXXX") || return 1
  stages[${#stages[@]}]=$STAGE
  stage_ids[${#stage_ids[@]}]=$(stat -c '%d:%i' -- "$STAGE") || return 1
  printf '%s\0' "$STAGE" >> "$work/staging"
}

replace() {
  local path=$1 kind=$2 value=$3 mode=$4 slot
  parents "${path%/*}" || return 1
  if [[ $kind == missing || -z $kind ]]; then rm -- "$path"; return; fi
  if [[ ! -d ${path%/*} ]]; then mkdir -p -- "${path%/*}" || return 1; fi
  parents "${path%/*}" || return 1
  stage_for_parent "${path%/*}" || return 1
  slot="$STAGE/value-${#stage_values[@]}"
  stage_values[${#stage_values[@]}]=$slot
  if [[ $kind == link ]]; then
    ln -s -- "$value" "$slot" || return 1
  else
    cp -- "$value" "$slot" && chmod "$mode" "$slot" && sync "$slot" || return 1
  fi
  mv -fT -- "$slot" "$path" || return 1
}

apply() {
  local index
  for ((index=0; index<${#destinations[@]}; index++)); do
    matches "${destinations[index]}" "${before_kind[index]}" "${before_value[index]}" "${modes[index]}" \
      || { fail "Destination changed during installation: ${destinations[index]}"; return 1; }
    applied=$((index + 1))
    replace "${destinations[index]}" "${after_kind[index]}" "${after_value[index]}" "${new_modes[index]}"
  done
  committed=1
}

clean_staging() {
  local index path value
  for ((index=0; index<${#stages[@]}; index++)); do
    path=${stages[index]}
    if ! present "$path"; then continue; fi
    stage_matches "$index" || return 1
    for value in "${stage_values[@]}"; do
      if [[ ${value%/*} == "$path" ]] && present "$value"; then rm -f -- "$value" || return 1; fi
    done
    rmdir -- "$path" || return 1
  done
}

clean_workspace() {
  parents "$work" && [[ $(stat -c '%d:%i' -- "$work") == "$work_id" ]] || return 1
  if [[ -n $lock_id ]]; then
    parents "$lock" && [[ $(stat -c '%d:%i' -- "$lock") == "$lock_id" ]] || return 1
  fi
  rm -rf -- "$work" || return 1
  if [[ -n $lock_id ]]; then rm -- "$lock/workspace" && rmdir -- "$lock"; fi
}

finish() {
  local status=$? index failed=0
  trap - EXIT HUP INT TERM
  set +e
  if [[ $committed == 0 && $applied -gt 0 ]]; then
    for ((index=applied-1; index>=0; index--)); do
      if matches "${destinations[index]}" "${before_kind[index]}" "${before_value[index]}" "${modes[index]}"; then continue; fi
      if matches "${destinations[index]}" "${after_kind[index]}" "${after_value[index]}" "${new_modes[index]}"; then
        replace "${destinations[index]}" "${before_kind[index]}" "${before_value[index]}" "${modes[index]}" || failed=1
      else failed=1; fi
    done
    if [[ $failed == 0 ]]; then fail 'Installation failed; prior links and settings restored.'
    else fail "Rollback incomplete; retained private recovery files at $work"; fi
  fi
  if [[ $failed == 0 ]]; then
    if ! clean_staging || ! clean_workspace; then
      fail "Cleanup incomplete; inspect $lock and $work"; failed=1
    fi
  fi
  [[ $failed == 0 ]] || status=1
  if [[ $status == 0 && $committed == 1 ]]; then printf '%s\n' 'Installed owned Claude and Pi resources.'; fi
  exit "$status"
}

install_package() {
  local state="$HOME/.local/state/ai-config" record index record_kind record_mode
  parents "$HOME"
  prepare
  parents "$state"; mkdir -p -- "$state"; parents "$state"
  lock="$state/install.lock.d"
  mkdir -- "$lock" 2>/dev/null || { fail "Another installer is running, or interrupted work needs inspection: $lock"; return 1; }
  lock_id=$(stat -c '%d:%i' -- "$lock")
  printf '%s\n' "$work" > "$lock/workspace"
  record="$state/installation.json"
  snapshot "$record" "$work/previous"; record_kind=$KIND; record_mode=$MODE
  if [[ $KIND == missing ]]; then
    json -nc --arg source "$root" '{version:2,source:$source,links:[],settings:[]}' > "$work/previous"
  else check_record "$work/previous"; fi
  plan_links; plan_settings
  if [[ $record_mode != 600 ]] || ! cmp -s "$work/previous" "$work/desired"; then
    add_action "$record" "$record_kind" "$work/previous" file "$work/desired" "$record_mode" 600
  fi
  apply
}

if [[ $# == 1 && ( $1 == --help || $1 == -h ) ]]; then usage; exit 0; fi
if [[ $# != 0 ]]; then fail 'Unsupported arguments; use no arguments to build and install.' || true; usage >&2; exit 2; fi
preflight
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
root=$(pwd -P)
parents "$root/tools/install"
for module in settings.jq manifest.jq permissions.json lsp-plugin.json; do
  regular "$root/tools/install/$module" 1048576
done
json -ne --arg home "${HOME:-}" 'include "manifest"; $home | absolute' >/dev/null 2>&1 \
  || { fail 'HOME must be an absolute non-root directory without traversal or control characters'; exit 1; }
[[ $HOME != "$root" && $HOME != "$root/"* ]] \
  || { fail 'Refusing to install inside the configuration source'; exit 1; }
mise install
mise exec -- make build
work=$(mktemp -d "${TMPDIR:-/tmp}/ai-install-XXXXXXXX")
work=$(cd "$work" && pwd -P)
work_id=$(stat -c '%d:%i' -- "$work")
lock='' lock_id='' applied=0 committed=0
declare -a destinations=() before_kind=() before_value=() after_kind=() after_value=() modes=() new_modes=() stages=() stage_ids=() stage_values=()
trap finish EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
install_package
