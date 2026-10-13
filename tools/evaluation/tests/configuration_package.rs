#[path = "support/package_fixture.rs"]
mod package_fixture;
use evaluation::configuration::{prepared_manifest, switch_configuration};
use package_fixture::{fixture, manifest};
use serde_json::json;
use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::process::Command;

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
    let package = prepared_manifest(&source).unwrap();
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
fn ordinary_package_installs_only_the_five_trial_specialists() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let package = prepared_manifest(&source).unwrap();
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
fn ordinary_package_does_not_install_a_claude_worktree_mod() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let package = prepared_manifest(&source).unwrap();
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
fn ordinary_package_installs_the_selected_host_resources_and_cli_dependencies_only() {
    let source = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let package = prepared_manifest(&source).unwrap();
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
                    | ".pi/agent/extensions/guard-policies.ts"
                    | ".pi/agent/extensions/status-footer.ts"
                    | ".claude/statusline.ts"
                    | ".claude/themes/catppuccin-mocha.json"
                    | ".pi/agent/themes/catppuccin-mocha.json"
                    | ".claude/plugins/ai-local-lsp"
                    | ".claude/commands/deliver.md"
                    | ".claude/commands/rebase.md"
                    | ".pi/agent/prompts/deliver.md"
                    | ".pi/agent/prompts/rebase.md"
                    | ".local/bin/wt"
                    | ".local/bin/worktree"
                    | ".local/bin/wl"
                    | ".local/bin/worklog"
                    | ".local/bin/artifact-review"
                    | ".local/bin/review-change-eval"
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
fn prepared_package_refuses_a_guard_that_claude_would_not_invoke() {
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
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
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
    let package = prepared_manifest(&fixture.path().canonicalize().unwrap()).unwrap();
    switch_configuration(&home, &package).unwrap();
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
    for cli in ["wt", "worktree", "wl", "worklog", "artifact-review"] {
        let output = Command::new(home.join(".local/bin").join(cli))
            .arg("--help")
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(output.stdout, b"disposable help\n");
    }
}

#[test]
fn prepared_package_requires_both_commit_skills_and_a_regular_skill_file() {
    for destination in [".claude/skills/commit", ".pi/agent/skills/commit"] {
        let fixture = fixture();
        manifest(fixture.path());
        let path = fixture.path().join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["links"]
            .as_array_mut()
            .unwrap()
            .retain(|link| link["destination"] != destination);
        fs::write(&path, value.to_string()).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
    {
        let fixture = fixture();
        manifest(fixture.path());
        fs::remove_file(fixture.path().join("skills/commit/SKILL.md")).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }

    for invalid in [
        "Fixture; never run.\n",
        "---\nname: other\ndescription: Wrong skill.\n---\n\nFixture.\n",
        "---\nname: commit\ndescription: \n---\n\nFixture.\n",
        "---\nname: commit\ndescription: Empty instructions.\n---\n",
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        fs::write(fixture.path().join("skills/commit/SKILL.md"), invalid).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
}

#[test]
fn prepared_package_refuses_missing_non_executable_or_cross_wired_bundled_tools() {
    for relative in [
        "tools/worktree/target/release/wt",
        "tools/worklog/target/release/wl",
        "tools/artifact-review/target/release/artifact-review",
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        fs::remove_file(fixture.path().join(relative)).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
    for mode in [0o644, 0o001] {
        let fixture = fixture();
        manifest(fixture.path());
        fs::set_permissions(
            fixture.path().join("tools/worklog/target/release/wl"),
            fs::Permissions::from_mode(mode),
        )
        .unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }

    let fixture = fixture();
    manifest(fixture.path());
    let path = fixture.path().join("manifest.json");
    let mut manifest: serde_json::Value =
        serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    manifest["links"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|link| link["destination"] == ".local/bin/wt")
        .unwrap()["target"] = json!("tools/worklog/target/release/wl");
    fs::write(&path, manifest.to_string()).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
}

#[test]
fn prepared_package_refuses_missing_or_cross_harness_resources() {
    for (destination, target) in [
        (".claude/CLAUDE.md", "harnesses/claude/guard.ts"),
        (
            ".pi/agent/extensions/guard-policies.ts",
            "harnesses/claude/guard.ts",
        ),
        (".claude/hooks/guard.ts", "harnesses/pi/guard-policies.ts"),
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        let path = fixture.path().join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["links"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|link| link["destination"] == destination)
            .unwrap()["target"] = json!(target);
        fs::write(&path, value.to_string()).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
    let fixture = fixture();
    manifest(fixture.path());
    fs::remove_file(fixture.path().join("harnesses/pi/guard-policies.ts")).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    let missing_bundle = package_fixture::fixture();
    manifest(missing_bundle.path());
    fs::remove_file(
        missing_bundle
            .path()
            .join("harnesses/pi/guard-policies.bundle.ts"),
    )
    .unwrap();
    assert!(prepared_manifest(&missing_bundle.path().canonicalize().unwrap()).is_err());
}

#[test]
fn prepared_package_refuses_a_directory_instead_of_a_required_adapter() {
    let fixture = fixture();
    manifest(fixture.path());
    let path = fixture.path().join("manifest.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["links"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|link| link["destination"] == ".claude/hooks/guard.ts")
        .unwrap()["target"] = json!("harnesses/claude");
    fs::write(&path, value.to_string()).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
}

#[test]
fn prepared_package_refuses_symlinks_inside_linked_resource_directories() {
    for destination in ["harnesses/pi/guard-policies.ts", "outside"] {
        let fixture = fixture();
        manifest(fixture.path());
        let directory = fixture.path().join("skills");
        fs::create_dir_all(&directory).unwrap();
        symlink(
            fixture.path().join(destination),
            directory.join("redirected"),
        )
        .unwrap();
        let path = fixture.path().join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["links"].as_array_mut().unwrap().push(json!({
            "destination": ".claude/skills/fixture", "target": "skills"
        }));
        fs::write(&path, value.to_string()).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
}

#[test]
fn prepared_package_accepts_regular_resources_inside_a_linked_skill_directory() {
    let fixture = fixture();
    manifest(fixture.path());
    let directory = fixture.path().join("skills/fixture");
    fs::create_dir_all(directory.join("references")).unwrap();
    fs::write(directory.join("SKILL.md"), "fixture\n").unwrap();
    fs::write(directory.join("references/guide.md"), "fixture\n").unwrap();
    let path = fixture.path().join("manifest.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["links"].as_array_mut().unwrap().push(json!({
        "destination": ".pi/agent/skills/fixture", "target": "skills/fixture"
    }));
    fs::write(&path, value.to_string()).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_ok());
}

#[test]
fn prepared_package_requires_its_bootstrap_rule_files_even_when_not_linked() {
    for relative in [
        "rules/testing.md",
        "harnesses/claude/harness-rules.md",
        "harnesses/claude/guard-verdict.ts",
        "guard/guard-core.ts",
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        fs::remove_file(fixture.path().join(relative)).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }
}

#[test]
fn prepared_package_refuses_redirected_bootstrap_rules_and_wrong_adapter_targets() {
    {
        let fixture = fixture();
        manifest(fixture.path());
        let rule = fixture.path().join("rules/testing.md");
        fs::remove_file(&rule).unwrap();
        symlink(fixture.path().join("rules/a5.md"), &rule).unwrap();
        assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    }

    let fixture = fixture();
    manifest(fixture.path());
    let path = fixture.path().join("manifest.json");
    let mut value: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    value["links"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|link| link["destination"] == ".claude/CLAUDE.md")
        .unwrap()["target"] = json!("rules/testing.md");
    fs::write(&path, value.to_string()).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
}

#[test]
fn prepared_package_requires_every_ordinary_harness_resource_link() {
    for destination in [
        ".claude/skills/plan",
        ".pi/agent/skills/work-log",
        ".claude/agents/api-designer.md",
        ".pi/agent/agents/fact-checker.md",
        ".pi/agent/extensions/guard-policies.ts",
        ".local/bin/wt",
        ".local/bin/wl",
        ".local/bin/artifact-review",
        ".local/bin/review-change-eval",
        ".claude/skills/review-change",
        ".pi/agent/skills/review-change",
    ] {
        let fixture = fixture();
        manifest(fixture.path());
        let path = fixture.path().join("manifest.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        let links = value["links"].as_array_mut().unwrap();
        let original = links.len();
        links.retain(|link| link["destination"] != destination);
        assert_eq!(
            links.len(),
            original - 1,
            "missing fixture entry: {destination}"
        );
        fs::write(&path, value.to_string()).unwrap();
        assert!(
            prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err(),
            "{destination}"
        );
    }
}

#[test]
fn prepared_package_refuses_redirected_or_duplicate_manifests() {
    let fixture = fixture();
    manifest(fixture.path());
    let path = fixture.path().join("manifest.json");
    let bytes = fs::read(&path).unwrap();
    fs::write(
        &path,
        format!(
            "{{\"version\":2,\"version\":2,\"source\":\"{}\",\"links\":[]}}",
            fixture.path().display()
        ),
    )
    .unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
    fs::remove_file(&path).unwrap();
    fs::write(fixture.path().join("outside"), bytes).unwrap();
    symlink(fixture.path().join("outside"), &path).unwrap();
    assert!(prepared_manifest(&fixture.path().canonicalize().unwrap()).is_err());
}
