use crate::support::package_fixture;
use crate::support::{
    package_manifest::{catalogue_manifest, installed_manifest, prepared_manifest},
    shell_install, success,
};
use package_fixture::{fixture, manifest};
use serde_json::json;
use std::fs;
use std::process::Command;

#[test]
fn catalogue_validation_uses_production_filters_without_running_the_installer() {
    let fixture = fixture();
    manifest(fixture.path());
    fs::write(
        fixture.path().join("install.sh"),
        "#!/bin/sh\nprintf invoked > \"$0.invoked\"\nexit 97\n",
    )
    .unwrap();
    let source = fixture.path().canonicalize().unwrap();
    let package = catalogue_manifest(&source).unwrap();
    assert_eq!(package.source, source);
    assert!(!fixture.path().join("install.sh.invoked").exists());
    assert!(
        package
            .links
            .iter()
            .any(|link| link.destination == std::path::Path::new(".pi/agent/AGENTS.md"))
    );
}

#[test]
fn prepared_package_requires_a_manifest_and_never_creates_home_state() {
    let fixture = fixture();
    let home = fixture.path().join("home");
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    assert!(!home.exists());
}

#[test]
fn prepared_package_accepts_both_native_bootstraps_and_guard_adapters() {
    let fixture = fixture();
    manifest(fixture.path());
    let package = prepared_manifest(&fixture.path().canonicalize().unwrap()).unwrap();
    assert!(
        package
            .links
            .iter()
            .any(|link| link.destination == std::path::Path::new(".claude/CLAUDE.md"))
    );
    assert!(
        package
            .links
            .iter()
            .any(|link| link.destination == std::path::Path::new(".pi/agent/AGENTS.md"))
    );
    assert_eq!(package.source, fixture.path().canonicalize().unwrap());
}

#[test]
fn ordinary_package_uses_one_root_level_resource_tree() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let package = catalogue_manifest(&source).unwrap();
    assert!(source.join("manifest.json").is_file());
    assert!(source.join("skills/code/SKILL.md").is_file());
    assert!(source.join("harnesses/pi/review-scope.ts").is_file());
    assert!(!source.join("native").exists());
    assert!(
        package
            .links
            .iter()
            .all(|link| !link.target.starts_with("native"))
    );
    assert!(package.links.iter().any(|link| {
        link.destination == std::path::Path::new(".claude/CLAUDE.md")
            && link.target == std::path::Path::new("baseline.md")
    }));
}

#[test]
fn ordinary_catalogue_selects_only_the_five_specialists() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let package = catalogue_manifest(&source).unwrap();
    let agents: std::collections::BTreeSet<_> = package
        .links
        .iter()
        .filter_map(|link| {
            link.destination
                .to_str()?
                .strip_prefix(".pi/agent/agents/")
                .map(str::to_owned)
        })
        .collect();
    assert_eq!(
        agents,
        [
            "api-designer.md",
            "change-reviewer.md",
            "database-reviewer.md",
            "fact-checker.md",
            "frontend-architect.md"
        ]
        .into_iter()
        .map(str::to_owned)
        .collect()
    );
}

#[test]
fn ordinary_catalogue_does_not_select_a_claude_worktree_mod() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let package = catalogue_manifest(&source).unwrap();
    assert!(
        package
            .links
            .iter()
            .all(|link| link.destination != std::path::Path::new(".claude/plugins/ai-worktree"))
    );
    assert!(package.settings.iter().all(|setting| {
        setting.path != ["env", "CLAUDE_CODE_PLUGIN_DIRS"]
            || setting.value == "~/.claude/plugins/ai-local-lsp"
    }));
}

#[test]
fn ordinary_catalogue_selects_host_cli_and_completion_resources_only() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let package = catalogue_manifest(&source).unwrap();
    let extras: Vec<_> = package
        .links
        .iter()
        .filter(|link| {
            let path = link.destination.to_string_lossy();
            !matches!(
                path.as_ref(),
                ".claude/CLAUDE.md"
                    | ".pi/agent/AGENTS.md"
                    | ".claude/hooks/guard.ts"
                    | ".claude/hooks/worktree.ts"
                    | ".claude/hooks/review-feedback.ts"
                    | ".pi/agent/extensions/worktree.ts"
                    | ".pi/agent/extensions/review-feedback.ts"
                    | ".pi/agent/extensions/guard-policies.ts"
                    | ".pi/agent/extensions/status-footer.ts"
                    | ".pi/agent/extensions/lsp.ts"
                    | ".claude/statusline.ts"
                    | ".claude/themes/catppuccin-mocha.json"
                    | ".pi/agent/themes/catppuccin-mocha.json"
                    | ".claude/plugins/ai-local-lsp"
                    | ".claude/commands/deliver.md"
                    | ".claude/commands/rebase.md"
                    | ".claude/commands/wt.md"
                    | ".pi/agent/prompts/deliver.md"
                    | ".pi/agent/prompts/rebase.md"
                    | ".local/bin/wt"
                    | ".local/bin/worktree"
                    | ".local/bin/wl"
                    | ".local/bin/worklog"
                    | ".local/bin/review-change"
                    | ".local/share/bash-completion/completions/wt"
                    | ".local/share/bash-completion/completions/worktree"
            ) && !path.starts_with(".claude/skills/")
                && !path.starts_with(".pi/agent/skills/")
                && !path.starts_with(".claude/agents/")
                && !path.starts_with(".pi/agent/agents/")
        })
        .map(|link| link.destination.clone())
        .collect();
    assert!(
        extras.is_empty(),
        "out-of-scope installed resources: {extras:?}"
    );
    assert!(package.settings.iter().any(|setting| {
        setting.path == ["statusLine", "command"] && setting.value == "bun ~/.claude/statusline.ts"
    }));
}

#[test]
fn prepared_package_resolves_a_relocatable_manifest_without_writing_the_source() {
    let fixture = fixture();
    manifest(fixture.path());
    let path = fixture.path().join("manifest.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["source"] = json!(".");
    fs::write(&path, value.to_string()).unwrap();
    let before = fs::read(&path).unwrap();
    let loaded = prepared_manifest(&fixture.path().canonicalize().unwrap()).unwrap();
    assert_eq!(loaded.source, fixture.path().canonicalize().unwrap());
    assert_eq!(fs::read(&path).unwrap(), before);
}

#[test]
fn catalogue_refuses_a_guard_that_claude_would_not_invoke() {
    for replacement in [
        json!([]),
        json!([{"destination": ".claude/settings.json", "path": ["hooks", "PreToolUse"],
            "mode": "array_entry", "value": {"matcher": "Write", "hooks": [{"type": "command", "command": "bun ~/.claude/hooks/guard.ts", "timeout": 10}]}}]),
        json!([{"destination": ".claude/settings.json", "path": ["hooks", "PreToolUse"],
            "mode": "array_entry", "value": {"hooks": [{"type": "command", "command": "bun /old/guard.ts", "timeout": 10}]}}]),
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        let path = fixture.path().join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let settings = value["settings"].as_array_mut().unwrap();
        settings.retain(|claim| claim["path"] != json!(["hooks", "PreToolUse"]));
        settings.extend(replacement.as_array().unwrap().iter().cloned());
        fs::write(path, value.to_string()).unwrap();
        assert!(catalogue_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
}

#[test]
fn guarded_package_preserves_preferences_and_installs_both_adapters_in_a_disposable_home() {
    let fixture = fixture();
    manifest(fixture.path());
    let temporary_home = tempfile::tempdir().unwrap();
    let home = temporary_home.path().canonicalize().unwrap();
    let claude = home.join(".claude/settings.json");
    let pi = home.join(".pi/agent/settings.json");
    fs::create_dir_all(claude.parent().unwrap()).unwrap();
    fs::create_dir_all(pi.parent().unwrap()).unwrap();
    fs::write(
        &claude,
        r#"{"model":"saved","permissions":{"allow":["Read(personal/**)"]}}"#,
    )
    .unwrap();
    fs::write(&pi, r#"{"defaultModel":"saved"}"#).unwrap();
    let source = fixture.path().canonicalize().unwrap();
    success(shell_install::command(&source, &home).output().unwrap());
    let package = installed_manifest(&home).unwrap();
    let settings: serde_json::Value = serde_json::from_slice(&fs::read(&claude).unwrap()).unwrap();
    assert_eq!(settings["model"], "saved");
    assert_eq!(settings["permissions"]["allow"][0], "Read(personal/**)");
    assert_eq!(settings["theme"], "custom:catppuccin-mocha");
    assert_eq!(
        settings["hooks"]["PreToolUse"][0]["hooks"][0]["command"],
        "bun ~/.claude/hooks/guard.ts"
    );
    assert_eq!(
        fs::read_link(home.join(".claude/hooks/guard.ts")).unwrap(),
        package.source.join("harnesses/claude/guard.ts")
    );
    assert_eq!(
        fs::read_link(home.join(".pi/agent/extensions/guard-policies.ts")).unwrap(),
        package.source.join("harnesses/pi/guard-policies.bundle.ts")
    );
    let pi_settings: serde_json::Value = serde_json::from_slice(&fs::read(pi).unwrap()).unwrap();
    assert_eq!(pi_settings["defaultModel"], "saved");
    assert_eq!(pi_settings["theme"], "catppuccin-mocha");
    for link in [".claude/skills/commit", ".pi/agent/skills/commit"] {
        assert_eq!(
            fs::read_link(home.join(link)).unwrap(),
            package.source.join("skills/commit")
        );
        assert!(
            fs::read_to_string(home.join(link).join("SKILL.md"))
                .unwrap()
                .contains("fixture")
        );
    }
    assert!(home.join(".claude/themes/catppuccin-mocha.json").exists());
    assert!(home.join(".pi/agent/themes/catppuccin-mocha.json").exists());
    let public = ["wt", "worktree", "wl", "worklog", "review-change"]
        .map(|cli| home.join(".local/bin").join(cli));
    let private = [
        "tools/artifact-review/target/release/review-artifact",
        "tools/evaluation/target/release/consult",
    ]
    .map(|helper| package.source.join(helper));
    for executable in public.into_iter().chain(private) {
        let output = Command::new(executable).arg("--help").output().unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"disposable help\n");
    }
}
