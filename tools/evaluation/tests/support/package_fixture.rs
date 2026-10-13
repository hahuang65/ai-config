//! Disposable inactive native package with syntactically valid owned resources.
use serde_json::json;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use tempfile::TempDir;

const SKILLS: &[&str] = &[
    "3d",
    "coach",
    "code",
    "commit",
    "grill",
    "handoff",
    "mockup",
    "model-domain",
    "pickup",
    "plan",
    "prototype",
    "resolve-conflicts",
    "review-artifact",
    "review-change",
    "spec",
    "visualize",
    "work-log",
    "worktree",
];
const AGENTS: &[&str] = &[
    "api-designer",
    "change-reviewer",
    "database-reviewer",
    "fact-checker",
    "frontend-architect",
];

pub fn fixture() -> TempDir {
    let temporary = tempfile::tempdir().unwrap();
    populate(temporary.path());
    temporary
}

pub fn populate(root: &Path) {
    for relative in [
        "baseline.md",
        "reviewer.md",
        "harnesses/pi/review-scope.ts",
        "commands/deliver.md",
        "commands/rebase.md",
        "skills/commit/SKILL.md",
        "harnesses/claude/guard.ts",
        "harnesses/claude/statusline.ts",
        "harnesses/claude/themes/catppuccin-mocha.json",
        "harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json",
        "harnesses/pi/guard-policies.ts",
        "harnesses/pi/guard-policies.bundle.ts",
        "harnesses/pi/status-footer.ts",
        "harnesses/pi/status-footer.bundle.ts",
        "harnesses/pi/themes/catppuccin-mocha.json",
        "harnesses/claude/harness-rules.md",
        "harnesses/claude/guard-verdict.ts",
        "harnesses/claude/read-only-github.ts",
        "agents/fact-checker.md",
        "guard/bash-command.ts",
        "guard/credential-guard.ts",
        "guard/guard-core.ts",
        "guard/guard-home.ts",
        "guard/inline-program-state-guard.ts",
        "guard/policy-registry.ts",
        "guard/review-publication-state-guard.ts",
        "rules/a5.md",
        "rules/cli-ergonomics.md",
        "rules/coding-style.md",
        "rules/documentation.md",
        "rules/git-commit.md",
        "rules/html-routing.md",
        "rules/mise.md",
        "rules/performance.md",
        "rules/security.md",
        "rules/testing.md",
    ] {
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        if relative == "harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json" {
            fs::write(
                path,
                include_bytes!(
                    "../../../../harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json"
                ),
            )
            .unwrap();
        } else {
            fs::write(path, "fixture; never run\n").unwrap();
        }
    }
    for name in SKILLS {
        let path = root.join(format!("skills/{name}/SKILL.md"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            path,
            format!("---\nname: {name}\ndescription: Fixture.\n---\n\nfixture; never run.\n"),
        )
        .unwrap();
    }
    for name in AGENTS {
        let path = root.join(format!("agents/{name}.md"));
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            path,
            format!("---\nname: {name}\ndescription: Fixture.\n---\n\nNo runtime.\n"),
        )
        .unwrap();
    }
    for relative in [
        "tools/worktree/target/release/wt",
        "tools/worklog/target/release/wl",
        "tools/artifact-review/target/release/artifact-review",
        "tools/evaluation/target/release/review-change-eval",
    ] {
        let binary = root.join(relative);
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::write(&binary, "#!/bin/sh\nprintf 'disposable help\n'\n").unwrap();
        fs::set_permissions(binary, fs::Permissions::from_mode(0o755)).unwrap();
    }
}

pub fn manifest(root: &Path) {
    let source = root.canonicalize().unwrap();
    let mut value = json!({"version": 2, "source": source, "settings": [{
        "destination": ".claude/settings.json", "path": ["hooks", "PreToolUse"],
        "mode": "array_entry", "value": {"hooks": [{"type": "command", "command": "bun ~/.claude/hooks/guard.ts", "timeout": 10}]}
    }], "links": [
        {"destination": ".claude/CLAUDE.md", "target": "baseline.md"},
        {"destination": ".pi/agent/AGENTS.md", "target": "baseline.md"},
        {"destination": ".claude/hooks/guard.ts", "target": "harnesses/claude/guard.ts"},
        {"destination": ".claude/statusline.ts", "target": "harnesses/claude/statusline.ts"},
        {"destination": ".claude/themes/catppuccin-mocha.json", "target": "harnesses/claude/themes/catppuccin-mocha.json"},
        {"destination": ".claude/plugins/ai-local-lsp", "target": "harnesses/claude/plugins/ai-local-lsp"},
        {"destination": ".pi/agent/extensions/guard-policies.ts", "target": "harnesses/pi/guard-policies.bundle.ts"},
        {"destination": ".pi/agent/extensions/status-footer.ts", "target": "harnesses/pi/status-footer.bundle.ts"},
        {"destination": ".pi/agent/themes/catppuccin-mocha.json", "target": "harnesses/pi/themes/catppuccin-mocha.json"},
        {"destination": ".claude/commands/deliver.md", "target": "commands/deliver.md"},
        {"destination": ".claude/commands/rebase.md", "target": "commands/rebase.md"},
        {"destination": ".pi/agent/prompts/deliver.md", "target": "commands/deliver.md"},
        {"destination": ".pi/agent/prompts/rebase.md", "target": "commands/rebase.md"},
        {"destination": ".claude/skills/commit", "target": "skills/commit"},
        {"destination": ".pi/agent/skills/commit", "target": "skills/commit"},
        {"destination": ".local/bin/wt", "target": "tools/worktree/target/release/wt"},
        {"destination": ".local/bin/worktree", "target": "tools/worktree/target/release/wt"},
        {"destination": ".local/bin/wl", "target": "tools/worklog/target/release/wl"},
        {"destination": ".local/bin/worklog", "target": "tools/worklog/target/release/wl"},
        {"destination": ".local/bin/artifact-review", "target": "tools/artifact-review/target/release/artifact-review"},
        {"destination": ".local/bin/review-change-eval", "target": "tools/evaluation/target/release/review-change-eval"}
    ]});
    let settings = value["settings"].as_array_mut().unwrap();
    settings.extend([
        json!({"destination": ".claude/settings.json", "path": ["theme"], "mode": "value", "value": "custom:catppuccin-mocha"}),
        json!({"destination": ".claude/settings.json", "path": ["statusLine", "type"], "mode": "value", "value": "command"}),
        json!({"destination": ".claude/settings.json", "path": ["statusLine", "command"], "mode": "value", "value": "bun ~/.claude/statusline.ts"}),
        json!({"destination": ".pi/agent/settings.json", "path": ["theme"], "mode": "value", "value": "catppuccin-mocha"}),
    ]);
    for name in [
        "disableArtifact",
        "disableBundledSkills",
        "disableClaudeAiConnectors",
        "disableRemoteControl",
        "disableWorkflows",
    ] {
        settings.push(
            json!({"destination": ".claude/settings.json", "path": [name],
            "mode": "value", "value": true}),
        );
    }
    for name in [
        "lua-lsp@claude-plugins-official",
        "bash-language-server@claude-code-lsps",
        "terraform-ls@claude-code-lsps",
        "gopls-lsp@claude-plugins-official",
    ] {
        settings.push(
            json!({"destination": ".claude/settings.json", "path": ["enabledPlugins", name],
            "mode": "value", "value": true}),
        );
    }
    settings.push(
        json!({"destination": ".claude/settings.json", "path": ["env", "CLAUDE_CODE_PLUGIN_DIRS"],
        "mode": "value", "value": "~/.claude/plugins/ai-local-lsp"}),
    );
    let defaults: serde_json::Value = serde_json::from_slice(include_bytes!(
        "../../src/configuration/legacy_defaults/claude.json"
    ))
    .unwrap();
    for group in ["deny", "ask", "additionalDirectories"] {
        for entry in defaults["permissions"][group].as_array().unwrap() {
            if group == "additionalDirectories" && entry == "~/.orchard" {
                continue;
            }
            settings.push(
                json!({"destination": ".claude/settings.json", "path": ["permissions", group],
                "mode": "array_entry", "value": entry}),
            );
        }
    }
    for value in [
        "Read(CONTEXT.md)",
        "Edit(CONTEXT.md)",
        "Read(docs/adr/**)",
        "Read(docs/features/**)",
        "Edit(**)",
        "Read(~/.gitmessage)",
    ] {
        settings.push(
            json!({"destination": ".claude/settings.json", "path": ["permissions", "allow"],
            "mode": "array_entry", "value": value}),
        );
    }
    let links = value["links"].as_array_mut().unwrap();
    for skill in SKILLS.iter().filter(|name| **name != "commit") {
        for (harness, target) in [(".claude", "skills"), (".pi/agent", "skills")] {
            links.push(json!({"destination": format!("{harness}/skills/{skill}"), "target": format!("{target}/{skill}")}));
        }
    }
    for name in AGENTS {
        for harness in [".claude", ".pi/agent"] {
            links.push(json!({"destination": format!("{harness}/agents/{name}.md"), "target": format!("agents/{name}.md")}));
        }
    }
    fs::write(root.join("manifest.json"), value.to_string()).unwrap();
}
