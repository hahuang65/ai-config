#!/bin/bash
# Build this checkout, then let the Rust installer manage owned resources.
set -euo pipefail

usage() {
  printf '%s\n' 'Usage: install.sh [-h|--help]' \
    'Run make build offline in this checkout, then install its Claude and Pi resources into HOME.' \
    'Requires make and the mise-managed build tools with cached dependencies; no tools are provisioned.' \
    'Use make build alone to build without installing. A live home requires separate approval.'
}

if [[ $# -eq 1 && ( $1 == --help || $1 == -h ) ]]; then
  usage
  exit 0
fi
if [[ $# -ne 0 ]]; then
  printf '%s\n' 'install.sh: unsupported arguments; use no arguments to build and install.' >&2
  usage >&2
  exit 2
fi

cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
root=$(pwd -P)
make build
exec "$root/tools/evaluation/target/release/ai-config" --root "$root" install
