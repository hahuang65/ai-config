#!/usr/bin/env python3
"""Sync permissions from Claude Code settings.json to OpenCode opencode.jsonc.

Claude Code is the source of truth. This script reads ~/.claude/settings.json,
converts the permission format, merges with OpenCode-only entries from
config/opencode-only.json, and writes ~/.config/opencode/opencode.jsonc.

Usage:
    python scripts/sync-permissions.py
    python scripts/sync-permissions.py --dry-run
"""

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
REPO_DIR = SCRIPT_DIR.parent
CLAUDE_SETTINGS = REPO_DIR / "claude" / "settings.json"
OPENCODE_CONFIG = REPO_DIR / "opencode" / "opencode.jsonc"
OPENCODE_ONLY = REPO_DIR / "config" / "opencode-only.json"

# Claude tools that map to OpenCode permission keys
TOOL_MAP = {
    "Bash": "bash",
    "Read": "read",
    "Write": "write",
    "Edit": "edit",
    "WebFetch": "webfetch",
    "WebSearch": "websearch",
}

# Claude tools to skip (no OpenCode equivalent or Claude-specific)
SKIP_TOOLS = {"Search", "Glob", "Grep"}

# Pattern to parse Claude permission entries: Tool(pattern) or Tool
ENTRY_RE = re.compile(r"^(\w+)(?:\((.+)\))?$")


def parse_claude_entry(entry):
    """Parse a Claude permission entry like 'Bash(echo *)' into (tool, pattern)."""
    m = ENTRY_RE.match(entry)
    if not m:
        return None, None
    return m.group(1), m.group(2)


def read_claude_permissions():
    """Read Claude settings and return permissions grouped by OpenCode tool key."""
    with open(CLAUDE_SETTINGS) as f:
        settings = json.load(f)

    perms = settings.get("permissions", {})
    result = defaultdict(dict)
    task_perms = {}

    for level in ("allow", "deny", "ask"):
        for entry in perms.get(level, []):
            tool, pattern = parse_claude_entry(entry)
            if tool is None:
                continue
            if tool in SKIP_TOOLS:
                continue

            if tool == "Task":
                # Task(Explore) → task.explore = level
                if pattern:
                    task_perms[pattern.lower()] = level
                continue

            oc_key = TOOL_MAP.get(tool)
            if oc_key is None:
                # Unmapped tool (e.g., future additions) — skip
                continue

            if pattern:
                result[oc_key][pattern] = level
            else:
                # No pattern means tool-level permission (e.g., WebFetch)
                result[oc_key] = level

    if task_perms:
        result["task"] = task_perms

    return result


def read_opencode_only():
    """Read OpenCode-only supplemental entries."""
    with open(OPENCODE_ONLY) as f:
        return json.load(f)


def merge_permissions(claude_perms, oc_only):
    """Merge Claude-derived permissions with OpenCode-only entries."""
    permission = {}

    # --- bash section ---
    bash = {"*": "ask"}
    # Add OpenCode-only bash entries
    bash.update(oc_only.get("permissions", {}).get("bash", {}))
    # Add Claude-derived bash entries (these override on conflict)
    if isinstance(claude_perms.get("bash"), dict):
        bash.update(claude_perms["bash"])
    permission["bash"] = bash

    # --- read section ---
    read = {"*": "allow"}
    if isinstance(claude_perms.get("read"), dict):
        read.update(claude_perms["read"])
    permission["read"] = read

    # --- write section ---
    if isinstance(claude_perms.get("write"), dict):
        write = {"*": "ask"}
        write.update(claude_perms["write"])
        permission["write"] = write

    # --- edit section ---
    if isinstance(claude_perms.get("edit"), dict):
        edit = {"*": "ask"}
        edit.update(claude_perms["edit"])
        permission["edit"] = edit

    # --- task section ---
    if isinstance(claude_perms.get("task"), dict):
        task = {"*": "ask"}
        task.update(claude_perms["task"])
        permission["task"] = task

    # --- simple tool permissions from OpenCode-only ---
    oc_perms = oc_only.get("permissions", {})
    for key in ("glob", "glob *", "grep", "grep *", "list", "skill",
                "todoread", "todowrite"):
        if key in oc_perms:
            permission[key] = oc_perms[key]

    # --- simple tool permissions from Claude ---
    for key in ("webfetch", "websearch"):
        if key in claude_perms:
            permission[key] = claude_perms[key]

    return permission


def build_opencode_config(permission, oc_only):
    """Build the full OpenCode config object."""
    config = {}
    # Preserve top-level OpenCode-only settings
    config.update(oc_only.get("top_level", {}))
    config["permission"] = permission
    return config


def main():
    dry_run = "--dry-run" in sys.argv

    claude_perms = read_claude_permissions()
    oc_only = read_opencode_only()
    permission = merge_permissions(claude_perms, oc_only)
    config = build_opencode_config(permission, oc_only)

    output = json.dumps(config, indent=2) + "\n"

    if dry_run:
        print(output)
        if OPENCODE_CONFIG.exists():
            print(f"\n# Would write to: {OPENCODE_CONFIG}", file=sys.stderr)
        return

    OPENCODE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    with open(OPENCODE_CONFIG, "w") as f:
        f.write(output)

    print(f"Wrote {OPENCODE_CONFIG}")


if __name__ == "__main__":
    main()
