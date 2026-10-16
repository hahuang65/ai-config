use crate::support::package_fixture;
use crate::support::package_manifest::prepared_manifest;
use serde_json::{Value, json};
use std::fs;

#[test]
fn package_selects_the_requested_claude_feature_disables() {
    let source = package_fixture::fixture();
    package_fixture::manifest(source.path());
    let manifest = prepared_manifest(&source.path().canonicalize().unwrap()).unwrap();
    for name in [
        "disableArtifact",
        "disableBundledSkills",
        "disableClaudeAiConnectors",
        "disableRemoteControl",
        "disableWorkflows",
    ] {
        assert!(
            manifest.settings.iter().any(|claim| {
                claim.destination.to_string_lossy() == ".claude/settings.json"
                    && claim.path == [name]
                    && claim.value == true
            }),
            "missing {name}"
        );
    }
}

#[test]
fn package_selects_language_servers_without_importing_plugin_skills() {
    let source = package_fixture::fixture();
    package_fixture::manifest(source.path());
    let manifest = prepared_manifest(&source.path().canonicalize().unwrap()).unwrap();
    for name in [
        "lua-lsp@claude-plugins-official",
        "bash-language-server@claude-code-lsps",
        "terraform-ls@claude-code-lsps",
        "gopls-lsp@claude-plugins-official",
    ] {
        assert!(
            manifest
                .settings
                .iter()
                .any(|claim| claim.path == ["enabledPlugins", name] && claim.value == true),
            "missing {name}"
        );
    }
    assert!(manifest.links.iter().any(|link| {
        link.destination.to_string_lossy() == ".claude/plugins/ai-local-lsp"
            && link.target.to_string_lossy() == "harnesses/claude/plugins/ai-local-lsp"
    }));
    assert!(manifest.settings.iter().any(|claim| {
        claim.path == ["env", "CLAUDE_CODE_PLUGIN_DIRS"]
            && claim.value == "~/.claude/plugins/ai-local-lsp"
    }));
    assert!(!manifest.settings.iter().any(|claim| {
        claim.path == ["enabledPlugins", "astral@astral-sh"]
            || claim.path == ["enabledPlugins", "ruby-skills@ruby-skills"]
            || claim.path == ["enabledPlugins", "ruby-lsp@ruby-skills"]
    }));
}

#[test]
fn language_server_plugin_cannot_import_extra_skills() {
    let source = package_fixture::fixture();
    package_fixture::manifest(source.path());
    let skill = source
        .path()
        .join("harnesses/claude/plugins/ai-local-lsp/skills/extra/SKILL.md");
    fs::create_dir_all(skill.parent().unwrap()).unwrap();
    fs::write(skill, "---\nname: extra\ndescription: Not selected.\n---\n").unwrap();
    assert!(prepared_manifest(&source.path().canonicalize().unwrap()).is_err());
}

#[test]
fn language_server_plugin_refuses_an_auto_installing_server_command() {
    let source = package_fixture::fixture();
    package_fixture::manifest(source.path());
    let plugin = source
        .path()
        .join("harnesses/claude/plugins/ai-local-lsp/.claude-plugin/plugin.json");
    let mut document: Value = serde_json::from_slice(&fs::read(&plugin).unwrap()).unwrap();
    document["lspServers"]["ruby"]["command"] = json!("gem install ruby-lsp");
    fs::write(plugin, document.to_string()).unwrap();
    assert!(prepared_manifest(&source.path().canonicalize().unwrap()).is_err());
}

#[test]
fn mvp_refuses_unrelated_worktree_settings() {
    for (path, value) in [
        (
            json!(["env", "CLAUDE_CODE_PLUGIN_DIRS"]),
            json!("${HOME}/.claude/plugins/ai-worktree"),
        ),
        (json!(["enabledPlugins", "astral@astral-sh"]), json!(true)),
    ] {
        let source = package_fixture::fixture();
        package_fixture::manifest(source.path());
        let file = source.path().join("manifest.json");
        let mut document: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        document["settings"].as_array_mut().unwrap().push(json!({
            "destination": ".claude/settings.json", "path": path,
            "mode": "value", "value": value
        }));
        fs::write(file, document.to_string()).unwrap();
        assert!(
            prepared_manifest(&source.path().canonicalize().unwrap()).is_err(),
            "{path:?}"
        );
    }
}

#[test]
fn losing_a_captured_deny_confirmation_or_scope_rule_refuses_preflight() {
    for (group, value) in [
        ("deny", "Bash(git push *)"),
        ("ask", "Read(*.env)"),
        ("additionalDirectories", "~/.config"),
        ("allow", "Read(CONTEXT.md)"),
    ] {
        let source = package_fixture::fixture();
        package_fixture::manifest(source.path());
        let file = source.path().join("manifest.json");
        let mut document: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
        let claims = document["settings"].as_array_mut().unwrap();
        let before = claims.len();
        claims.retain(|claim| {
            claim["path"] != json!(["permissions", group]) || claim["value"] != value
        });
        assert_eq!(claims.len(), before - 1, "missing fixture: {group} {value}");
        fs::write(&file, document.to_string()).unwrap();
        assert!(
            prepared_manifest(&source.path().canonicalize().unwrap()).is_err(),
            "{group}: {value}"
        );
    }
}

#[test]
fn a_package_cannot_reintroduce_old_source_runtime_commands() {
    let source = package_fixture::fixture();
    package_fixture::manifest(source.path());
    let file = source.path().join("manifest.json");
    let mut document: Value = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    document["settings"].as_array_mut().unwrap().push(json!({
        "destination": ".claude/settings.json", "path": ["hooks", "SessionStart"],
        "mode": "array_entry", "value": {"hooks": [{"type":"command",
            "command":"bun ~/.dotfiles/ai/hooks/retired.ts"}]}
    }));
    fs::write(&file, document.to_string()).unwrap();
    assert!(prepared_manifest(&source.path().canonicalize().unwrap()).is_err());
}
