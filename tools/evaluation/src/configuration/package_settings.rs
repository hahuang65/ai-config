//! Narrow claims that make the inactive harness configuration usable.
use crate::configuration::{Manifest, Mode};
use anyhow::{Context, Result, ensure};
use serde_json::Value;
use std::path::Path;

fn retained_permission(manifest: &Manifest, group: &str, value: &Value) -> Result<()> {
    ensure!(
        manifest.settings.iter().any(|claim| {
            claim.destination == Path::new(".claude/settings.json")
                && claim.mode == Mode::ArrayEntry
                && claim
                    .path
                    .iter()
                    .map(String::as_str)
                    .eq(["permissions", group])
                && &claim.value == value
        }),
        "Native package loses a captured Claude permission: {group}"
    );
    Ok(())
}

fn retained_safety_settings(manifest: &Manifest) -> Result<()> {
    let captured: Value = serde_json::from_slice(include_bytes!("legacy_defaults/claude.json"))?;
    for group in ["deny", "ask", "additionalDirectories"] {
        let rules = captured["permissions"][group]
            .as_array()
            .context("Captured Claude permissions must be arrays")?;
        for rule in rules {
            if group != "additionalDirectories" || rule != "~/.orchard" {
                retained_permission(manifest, group, rule)?;
            }
        }
    }
    for rule in [
        "Read(CONTEXT.md)",
        "Edit(CONTEXT.md)",
        "Read(docs/adr/**)",
        "Read(docs/features/**)",
        "Edit(**)",
        "Read(~/.gitmessage)",
    ] {
        retained_permission(manifest, "allow", &Value::from(rule))?;
    }
    Ok(())
}

pub(super) fn check(manifest: &Manifest) -> Result<()> {
    retained_safety_settings(manifest)?;
    for claim in &manifest.settings {
        let claude = claim.destination == Path::new(".claude/settings.json");
        let selected_ui = claude
            && claim.mode == Mode::Value
            && match claim.path.as_slice() {
                [theme] if theme == "theme" => claim.value == "custom:catppuccin-mocha",
                [feature]
                    if matches!(
                        feature.as_str(),
                        "disableArtifact"
                            | "disableBundledSkills"
                            | "disableClaudeAiConnectors"
                            | "disableRemoteControl"
                            | "disableWorkflows"
                    ) =>
                {
                    claim.value == true
                }
                [group, name] if group == "enabledPlugins" => {
                    matches!(
                        name.as_str(),
                        "lua-lsp@claude-plugins-official"
                            | "bash-language-server@claude-code-lsps"
                            | "terraform-ls@claude-code-lsps"
                            | "gopls-lsp@claude-plugins-official"
                    ) && claim.value == true
                }
                [group, name] if group == "env" && name == "CLAUDE_CODE_PLUGIN_DIRS" => {
                    claim.value == "~/.claude/plugins/ai-local-lsp"
                }
                [status, kind] if status == "statusLine" && kind == "type" => {
                    claim.value == "command"
                }
                [status, command] if status == "statusLine" && command == "command" => {
                    claim.value == "bun ~/.claude/statusline.ts"
                }
                _ => false,
            };
        let pi_theme = claim.destination == Path::new(".pi/agent/settings.json")
            && claim.path == ["theme"]
            && claim.mode == Mode::Value
            && claim.value == "catppuccin-mocha";
        ensure!(
            selected_ui
                || pi_theme
                || (claude
                    && (claim.path == ["hooks", "PreToolUse"]
                        || (claim.path.len() == 2 && claim.path[0] == "permissions"))),
            "MVP cannot own unrelated harness settings"
        );
        ensure!(
            !claim.value.to_string().contains(".dotfiles/ai"),
            "Native package setting invokes the retired configuration source"
        );
    }
    Ok(())
}
