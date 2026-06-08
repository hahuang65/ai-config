#!/usr/bin/env bash
#
# gen-pi-agents.sh — generate pi's global always-on instruction file.
#
# pi (@earendil-works/pi-coding-agent) has no native rulebook and loads global
# instructions from a single file, ~/.pi/agent/AGENTS.md, at startup. So the
# shared advisory rules are concatenated here into one file, committed as
# harnesses/pi/advisory-rules.md and symlinked by the pi module as pi's
# ~/.pi/agent/AGENTS.md (ADR-0013). The enforcement guardrails reach pi
# separately, through the tier-A guard extension.
#
# Regenerate the committed copy with `make rules`. A gate drift-check
# (test-pipeline.sh content) fails if the committed copy is stale, so a
# forgotten regeneration cannot be committed. Output is deterministic.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Print a rule body with its leading YAML frontmatter stripped.
strip_frontmatter() {
  awk 'NR==1 && $0=="---"{fm=1; next} fm==1 && $0=="---"{fm=0; next} fm!=1{print}' "$1"
}

cat <<'EOF'
<!-- GENERATED from rules/*.md by scripts/gen-pi-agents.sh — do not edit by hand; run `make rules`. -->

# Advisory rules

Always-on guidance shared across every harness. This is guidance, not
enforcement: the dangerous-action guardrails are blocked mechanically by the
guard extension regardless of what these say.
EOF

for rule in "$REPO_DIR"/rules/*.md; do
  name="$(basename "$rule" .md)"
  printf '\n\n<!-- rule: %s -->\n\n' "$name"
  strip_frontmatter "$rule"
done
