#[allow(dead_code)]
use crate::support::{
    package_fixture,
    package_manifest::{Mode, catalogue_manifest, installed_manifest},
    shell_install,
};
use std::fs;
use std::path::{Path, PathBuf};

fn copy_tree(source: &Path, destination: &Path) {
    fs::create_dir_all(destination).unwrap();
    for entry in fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        let target = destination.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn relocated_package() -> tempfile::TempDir {
    let package = package_fixture::fixture();
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    for directory in [
        "skills",
        "agents",
        "commands",
        "rules",
        "guard",
        "harnesses",
    ] {
        copy_tree(&repository.join(directory), &package.path().join(directory));
    }
    for file in [
        "manifest.json",
        "language-servers.json",
        "baseline.md",
        "reviewer.md",
    ] {
        fs::copy(repository.join(file), package.path().join(file)).unwrap();
    }
    package
}

#[test]
fn production_manifest_is_relocatable_and_covers_both_complete_harness_catalogues() {
    let package = relocated_package();
    let source = package.path().canonicalize().unwrap();
    let manifest = catalogue_manifest(&source).unwrap();
    let links: Vec<_> = manifest
        .links
        .iter()
        .map(|link| link.destination.as_path())
        .collect();
    for name in [
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
    ] {
        for directory in [".claude", ".pi/agent"] {
            assert!(links.contains(&PathBuf::from(format!("{directory}/skills/{name}")).as_path()));
        }
    }
    for name in [
        "api-designer",
        "change-reviewer",
        "database-reviewer",
        "fact-checker",
        "frontend-architect",
    ] {
        for directory in [".claude", ".pi/agent"] {
            assert!(
                links.contains(&PathBuf::from(format!("{directory}/agents/{name}.md")).as_path())
            );
        }
    }
    for destination in [
        ".claude/hooks/guard.ts",
        ".pi/agent/extensions/guard-policies.ts",
        ".pi/agent/extensions/status-footer.ts",
        ".pi/agent/extensions/lsp.ts",
        ".claude/statusline.ts",
        ".claude/themes/catppuccin-mocha.json",
        ".pi/agent/themes/catppuccin-mocha.json",
        ".claude/commands/deliver.md",
        ".pi/agent/prompts/rebase.md",
        ".local/bin/wt",
        ".local/bin/wl",
        ".local/bin/review-change",
    ] {
        assert!(links.contains(&Path::new(destination)));
    }
    for destination in [
        ".pi/agent/extensions/wt.ts",
        ".claude/plugins/ai-worktree",
        ".local/bin/artifact-review",
        ".local/bin/review-artifact",
        ".local/bin/consult",
        ".local/bin/review-change-eval",
    ] {
        assert!(!links.contains(&Path::new(destination)));
    }
    assert_eq!(manifest.source, source);
}

#[test]
fn production_manifest_retains_other_captured_claude_denials_and_allows_questions() {
    let package = relocated_package();
    let manifest = catalogue_manifest(&package.path().canonicalize().unwrap()).unwrap();
    let legacy = package_fixture::legacy_claude_settings();
    for group in ["deny", "ask", "additionalDirectories"] {
        for value in legacy["permissions"][group].as_array().unwrap() {
            if (group == "additionalDirectories" && value == "~/.orchard")
                || (group == "deny" && value == "AskUserQuestion")
            {
                continue;
            }
            assert!(
                manifest.settings.iter().any(|claim| {
                    claim.destination == Path::new(".claude/settings.json")
                        && claim.path == ["permissions", group]
                        && claim.mode == Mode::ArrayEntry
                        && &claim.value == value
                }),
                "lost captured Claude permissions.{group} rule: {value}"
            );
        }
    }
    assert!(!manifest.settings.iter().any(|claim| {
        claim.path == ["permissions", "deny"] && claim.value == "AskUserQuestion"
    }));
    for rule in [
        "AskUserQuestion",
        "Read(CONTEXT.md)",
        "Edit(CONTEXT.md)",
        "Read(docs/adr/**)",
        "Read(docs/features/**)",
        "Edit(**)",
        "Read(~/.gitmessage)",
    ] {
        assert!(
            manifest
                .settings
                .iter()
                .any(|claim| { claim.path == ["permissions", "allow"] && claim.value == rule }),
            "lost ordinary permission: {rule}"
        );
    }
}

#[test]
fn public_installer_links_the_real_relocated_package_without_changing_private_state() {
    let package = relocated_package();
    let source = package.path().canonicalize().unwrap();
    let home = tempfile::tempdir().unwrap();
    let home_path = home.path().canonicalize().unwrap();
    for (relative, contents) in [
        (
            ".claude/settings.json",
            r#"{"model":"kept-claude","enabledPlugins":{"personal@local":false}}"#,
        ),
        (
            ".pi/agent/settings.json",
            r#"{"defaultProvider":"kept-provider","defaultThinkingLevel":"high"}"#,
        ),
        (".claude/.credentials.json", "fake-claude-credentials"),
        (".pi/agent/auth.json", "fake-pi-credentials"),
        (
            ".claude/projects/private/session.jsonl",
            "fake conversation",
        ),
        (".pi/agent/sessions/private.jsonl", "fake conversation"),
        (".config/typesafe/independent", "unrelated configuration"),
    ] {
        let path = home.path().join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }
    let install = || {
        shell_install::command(&source, &home_path)
            .output()
            .unwrap()
    };
    for _ in 0..2 {
        let output = install();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let manifest = catalogue_manifest(&source).unwrap();
    let installed = installed_manifest(&home_path).unwrap();
    assert_eq!(installed.source, source);
    assert_eq!(installed.links, manifest.links);
    for link in &manifest.links {
        assert_eq!(
            fs::read_link(home.path().join(&link.destination)).unwrap(),
            source.join(&link.target)
        );
    }
    let claude: serde_json::Value =
        serde_json::from_slice(&fs::read(home.path().join(".claude/settings.json")).unwrap())
            .unwrap();
    let pi: serde_json::Value =
        serde_json::from_slice(&fs::read(home.path().join(".pi/agent/settings.json")).unwrap())
            .unwrap();
    assert_eq!(claude["model"], "kept-claude");
    assert_eq!(claude["enabledPlugins"]["personal@local"], false);
    assert_eq!(pi["defaultProvider"], "kept-provider");
    assert_eq!(pi["defaultThinkingLevel"], "high");
    for relative in [
        ".claude/.credentials.json",
        ".pi/agent/auth.json",
        ".claude/projects/private/session.jsonl",
        ".pi/agent/sessions/private.jsonl",
        ".config/typesafe/independent",
    ] {
        assert_eq!(
            fs::read(home.path().join(relative)).unwrap(),
            if relative.contains("credentials") {
                b"fake-claude-credentials".as_slice()
            } else if relative.contains("auth.json") {
                b"fake-pi-credentials".as_slice()
            } else if relative.contains("independent") {
                b"unrelated configuration".as_slice()
            } else {
                b"fake conversation".as_slice()
            }
        );
    }
}
