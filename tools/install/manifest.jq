# Package and recorded-ownership validation; filesystem effects stay in install.sh.
def require($condition; $message): if $condition then . else error($message) end;
def text: type == "string" and test("[^\\s]") and (test("[\\x00-\\x1f]") | not);
def relative: text and (split("/") | all(. != "" and . != "." and . != ".."));
def absolute: text and startswith("/") and (.[1:] | relative);
def link_destination:
  . as $path
  | ([".claude/CLAUDE.md", ".claude/AGENTS.md", ".claude/statusline.sh", ".claude/statusline.ts",
      ".claude/hooks.json", ".claude/plugins/ai-worktree", ".claude/plugins/ai-local-lsp",
      ".pi/agent/AGENTS.md", ".pi/agent/SYSTEM.md", ".pi/agent/APPEND_SYSTEM.md"] | index($path)) != null
    or test("^\\.claude/(skills|commands|agents|hooks|themes)/.+$")
    or test("^\\.pi/agent/(skills|prompts|agents|extensions|themes)/.+$")
    or test("^\\.local/bin/[^/]+$");

def allowed_setting:
  . as $s | .value as $v | .path as $p
  | if .destination == ".claude/settings.json" then
      if .mode == "value" then
        (($p == ["theme"] or $p == ["tui"] or $p == ["env", "DISABLE_AUTOUPDATER"]
          or $p == ["env", "CLAUDE_CODE_PLUGIN_DIRS"] or $p == ["statusLine", "type"]
          or $p == ["statusLine", "command"]) and ($v | type) == "string")
        or ((($p | length) == 1 and (["disableArtifact", "disableBundledSkills", "disableClaudeAiConnectors",
          "disableRemoteControl", "disableWorkflows"] | index($p[0])) != null
          or (($p | length) == 2 and $p[0] == "enabledPlugins")) and ($v | type) == "boolean")
        or ($p == ["statusLine", "padding"] and ($v | type) == "number" and $v >= 0
          and $v <= 18446744073709551615 and ($v | floor) == $v)
      elif .mode == "array_entry" then
        ($p | length) == 2 and (($p[0] == "permissions" and ($v | type) == "string"
          and (["allow", "deny", "ask", "additionalDirectories"] | index($p[1])) != null)
          or ($p[0] == "hooks" and ($v | type) == "object"))
      else false end
    elif .destination == ".pi/agent/settings.json" then
      (.mode == "value" and (($p == ["theme"] or $p == ["tuiMode"]) and ($v | type) == "string"
        or $p == ["quietStartup"] and ($v | type) == "boolean"))
      or (.mode == "array_entry" and ($p | length) == 1 and ($v | type) == "string"
        and (["extensions", "skills", "prompts", "themes"] | index($p[0])) != null)
    else false end;

def record:
  require(type == "object" and (keys - ["version", "source", "links", "settings"] | length) == 0;
    "Invalid ownership record fields")
  | if has("settings") then . else .settings = [] end
  | require((.version == 2 or .version == 1 and (.settings | length) == 0) and (.source | absolute)
      and (.links | type) == "array" and (.settings | type) == "array"; "Invalid ownership record")
  | require(all(.links[]; keys == ["destination", "target"] and (.target | relative)
      and (.destination | relative) and (.destination | link_destination)); "Invalid link declaration")
  | require((.links | map(.destination) | unique | length) == (.links | length); "Duplicate destination")
  | require(all(.settings[]; keys == ["destination", "mode", "path", "value"]
      and (.path | type) == "array" and (.path | length) > 0 and all(.path[]; text)
      and allowed_setting); "Unsupported managed settings field or value");

def skills: ["3d", "coach", "code", "commit", "grill", "handoff", "mockup", "model-domain", "pickup",
  "plan", "prototype", "resolve-conflicts", "review-artifact", "review-change", "spec", "visualize", "work-log", "worktree"];
def agents: ["api-designer", "change-reviewer", "database-reviewer", "fact-checker", "frontend-architect"];
def public_tools: {
  ".local/bin/wt": "tools/worktree/target/release/wt", ".local/bin/worktree": "tools/worktree/target/release/wt",
  ".local/bin/wl": "tools/worklog/target/release/wl", ".local/bin/worklog": "tools/worklog/target/release/wl",
  ".local/bin/review-change": "tools/evaluation/target/release/review-change"};
def private_tools: ["tools/artifact-review/target/release/review-artifact", "tools/evaluation/target/release/consult"];
def bootstrap: {
  ".claude/CLAUDE.md": "baseline.md", ".pi/agent/AGENTS.md": "baseline.md",
  ".claude/hooks/guard.ts": "harnesses/claude/guard.ts", ".claude/hooks/worktree.ts": "harnesses/claude/worktree.ts",
  ".pi/agent/extensions/worktree.ts": "harnesses/pi/worktree.bundle.ts",
  ".claude/statusline.ts": "harnesses/claude/statusline.ts",
  ".claude/themes/catppuccin-mocha.json": "harnesses/claude/themes/catppuccin-mocha.json",
  ".pi/agent/extensions/guard-policies.ts": "harnesses/pi/guard-policies.bundle.ts",
  ".pi/agent/extensions/status-footer.ts": "harnesses/pi/status-footer.bundle.ts",
  ".pi/agent/extensions/lsp.ts": "harnesses/pi/lsp.bundle.ts",
  ".pi/agent/themes/catppuccin-mocha.json": "harnesses/pi/themes/catppuccin-mocha.json",
  ".claude/plugins/ai-local-lsp": "harnesses/claude/plugins/ai-local-lsp"};
# Explicit construction avoids any catalogue dependency on a mutable manifest.
def catalogue:
  (bootstrap + public_tools | to_entries | map({destination: .key, target: .value}))
  + [skills[] as $name | [".claude", ".pi/agent"][] as $h
      | {destination: "\($h)/skills/\($name)", target: "skills/\($name)"}]
  + [agents[] as $name | [".claude", ".pi/agent"][] as $h
      | {destination: "\($h)/agents/\($name).md", target: "agents/\($name).md"}]
  + [("deliver", "rebase") as $name | (".claude/commands", ".pi/agent/prompts") as $directory
      | {destination: "\($directory)/\($name).md", target: "commands/\($name).md"}];

def support_files: [
  "harnesses/worktree-client.ts", "docs/worktree-transitions.md", "harnesses/pi/worktree.ts",
  "language-servers.json", "harnesses/pi/lsp.ts", "harnesses/pi/lsp/client.ts",
  "harnesses/pi/lsp/documents.ts", "harnesses/pi/lsp/transport.ts", "harnesses/pi/lsp/diagnostics.ts",
  "harnesses/pi/review-scope.ts", "reviewer.md", "harnesses/pi/guard-policies.ts", "harnesses/pi/status-footer.ts",
  "harnesses/claude/harness-rules.md", "harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json",
  "harnesses/claude/guard-verdict.ts", "harnesses/claude/read-only-github.ts", "guard/bash-command.ts",
  "guard/credential-guard.ts", "guard/guard-core.ts", "guard/guard-home.ts", "guard/inline-program-state-guard.ts",
  "guard/policy-registry.ts", "guard/review-publication-state-guard.ts",
  "guard/command-invocations.ts", "guard/dangerous-command-guard.ts",
  "guard/recursive-delete-guard.ts", "guard/remote-execution-guard.ts",
  "guard/shell-parser.ts", "guard/shell-values.ts", "guard/system-command-guards.ts", "guard/interpreter-input.ts",
  "guard/vendor/tree-sitter.mjs", "guard/vendor/web-tree-sitter.wasm", "guard/vendor/tree-sitter-bash.wasm",
  "guard/vendor/web-tree-sitter.LICENSE", "guard/vendor/tree-sitter-bash.LICENSE",
  "rules/a5.md", "rules/cli-ergonomics.md", "rules/coding-style.md", "rules/documentation.md", "rules/git-commit.md",
  "rules/html-routing.md", "rules/mise.md", "rules/performance.md", "rules/security.md", "rules/testing.md"]
  + (bootstrap | [.[] | select(. != "harnesses/claude/plugins/ai-local-lsp")])
  + (public_tools | [.[]]) + private_tools + [skills[] | "skills/\(.)/SKILL.md"]
  + [agents[] | "agents/\(.).md"] + ["commands/deliver.md", "commands/rebase.md"];

def worktree_hook($event):
  {hooks: [{type: "command", command: "bun ~/.claude/hooks/worktree.ts",
    timeout: (if $event == "WorktreeCreate" then 120 else 15 end)}]}
  + (if $event == "PostToolUse" then {matcher: "EnterWorktree|ExitWorktree"} else {} end);
def selected_setting:
  .value as $v | .path as $p
  | if .destination == ".pi/agent/settings.json" then $p == ["theme"] and $v == "catppuccin-mocha"
    elif .mode == "array_entry" then
      $p == ["hooks", "PreToolUse"] or $p[0] == "permissions"
      or ($p[0] == "hooks" and (["PostToolUse", "WorktreeCreate", "WorktreeRemove"] | index($p[1])) != null
        and $v == worktree_hook($p[1]))
    else
      $p == ["theme"] and $v == "custom:catppuccin-mocha"
      or $p == ["statusLine", "type"] and $v == "command"
      or $p == ["statusLine", "command"] and $v == "bun ~/.claude/statusline.ts"
      or $p == ["env", "CLAUDE_CODE_PLUGIN_DIRS"] and $v == "~/.claude/plugins/ai-local-lsp"
      or (($p | length) == 1 and $v == true and (["disableArtifact", "disableBundledSkills",
        "disableClaudeAiConnectors", "disableRemoteControl", "disableWorkflows"] | index($p[0])) != null)
      or ($p[0] == "enabledPlugins" and $v == false and (["lua-lsp@claude-plugins-official",
        "bash-language-server@claude-code-lsps", "terraform-ls@claude-code-lsps",
        "gopls-lsp@claude-plugins-official"] | index($p[1])) != null)
    end;

def native_package($permissions):
  record | . as $package
  | require(.version == 2 and all(catalogue[]; . as $link | ($package.links | index($link)) != null);
      "Missing required package resource")
  | require(all(.links[]; . as $link | (.target | startswith("skills/") or startswith("agents/")
        or startswith("commands/") or . == "baseline.md") and (.destination | startswith(".claude/") or startswith(".pi/agent/"))
      or (.destination | startswith(".claude/")) and (.target | startswith("harnesses/claude/"))
      or (.destination | startswith(".pi/agent/")) and (.target | startswith("harnesses/pi/"))
      or (public_tools[$link.destination] == $link.target)); "Package crosses harness module boundaries")
  | require(all(.settings[]; selected_setting and (.value | tojson | contains(".dotfiles/ai") | not));
      "Package claims unrelated harness settings")
  | require(all($permissions | to_entries[]; . as $group | all(.value[]; . as $value
      | any($package.settings[]; .destination == ".claude/settings.json" and .mode == "array_entry"
        and .path == ["permissions", $group.key] and .value == $value))); "Package loses a required permission")
  | require(any(.settings[]; .destination == ".claude/settings.json" and .mode == "array_entry"
      and .path == ["hooks", "PreToolUse"] and .value == {hooks: [{type: "command",
        command: "bun ~/.claude/hooks/guard.ts", timeout: 10}]}); "Package lacks the guard hook")
  | require(all(["PreToolUse", "PostToolUse", "WorktreeCreate", "WorktreeRemove"][]; . as $event
      | any($package.settings[]; .destination == ".claude/settings.json" and .mode == "array_entry"
        and .path == ["hooks", $event] and .value == worktree_hook($event))); "Package lacks a task hook");

def link_plan($previous):
  . as $desired
  | [($previous.links[] | {destination, before: ($previous.source + "/" + .target)}),
      (.links[] | {destination, after: ($desired.source + "/" + .target)})]
  | group_by(.destination) | map(add) | . as $plan
  | require(all(.[]; .destination as $path | all($plan[];
      (.destination | startswith($path + "/")) | not)); "Overlapping installation destinations")
  | .[] | .destination, "\u0000", (.before // ""), "\u0000", (.after // ""), "\u0000";
