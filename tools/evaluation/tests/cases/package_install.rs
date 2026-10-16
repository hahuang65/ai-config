use crate::support::{package_fixture, shell_install};
use serde_json::Value;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::Path;
use std::process::{Command, Output};

fn package() -> tempfile::TempDir {
    let source = package_fixture::fixture();
    package_fixture::manifest(source.path());
    source
}

fn command(source: &Path, home: &Path) -> Command {
    shell_install::command(source, home)
}

fn status(output: Output, expected: i32) {
    assert_eq!(
        output.status.code(),
        Some(expected),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn help_and_retired_adoption_flags_need_no_package_or_home_state() {
    let temporary = tempfile::tempdir().unwrap();
    let home = temporary.path().join("home");
    let installer = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../install.sh");
    let run = |args: &[&str]| {
        Command::new(&installer)
            .env("HOME", &home)
            .args(args)
            .output()
            .unwrap()
    };
    status(run(&["--help"]), 0);
    for args in [
        &["--legacy-shared", "/temporary/source"][..],
        &["--legacy-worklog", "/temporary/source"],
        &["--legacy-evaluation", "/temporary/source"],
        &["--legacy-agentmemory", "/temporary/source"],
        &["--legacy-pi-subagents", "/temporary/source"],
        &["--check"],
        &["--unexpected", "/temporary/source"],
    ] {
        status(run(args), 2);
    }
    assert!(!home.exists());
}

#[test]
fn fresh_install_does_not_need_legacy_authority_or_touch_unrelated_files() {
    let package = package();
    let source = package.path().canonicalize().unwrap();
    let home_directory = tempfile::tempdir().unwrap();
    let home = home_directory.path().canonicalize().unwrap();
    fs::create_dir(home.join(".claude")).unwrap();
    fs::write(home.join(".claude/personal.txt"), "personal").unwrap();
    status(command(&source, &home).output().unwrap(), 0);
    assert_eq!(
        fs::read(home.join(".claude/personal.txt")).unwrap(),
        b"personal"
    );
    assert_eq!(
        fs::read_link(home.join(".pi/agent/AGENTS.md")).unwrap(),
        source.join("baseline.md")
    );
    status(command(&source, &home).output().unwrap(), 0);
}

#[test]
fn local_lsp_plugin_refuses_to_replace_a_personal_plugin_directory_setting() {
    let package = package();
    let source = package.path().canonicalize().unwrap();
    let home_directory = tempfile::tempdir().unwrap();
    let home = home_directory.path().canonicalize().unwrap();
    let personal = home.join(".claude/plugins/personal/plugin.json");
    fs::create_dir_all(personal.parent().unwrap()).unwrap();
    fs::write(&personal, "personal plugin").unwrap();
    fs::write(
        home.join(".claude/settings.json"),
        r#"{"env":{"CLAUDE_CODE_PLUGIN_DIRS":"personal"}}"#,
    )
    .unwrap();
    status(command(&source, &home).output().unwrap(), 1);
    assert!(!home.join(".claude/plugins/ai-local-lsp").exists());
    assert!(!home.join(".claude/plugins/ai-worktree").exists());
    assert_eq!(fs::read(&personal).unwrap(), b"personal plugin");
    let settings: Value =
        serde_json::from_slice(&fs::read(home.join(".claude/settings.json")).unwrap()).unwrap();
    assert_eq!(settings["env"]["CLAUDE_CODE_PLUGIN_DIRS"], "personal");
}

#[test]
fn public_installer_requires_regular_reviewer_support_before_changing_either_harness() {
    for relative in ["harnesses/pi/review-scope.ts", "reviewer.md"] {
        for redirected in [false, true] {
            let package = package();
            let source = package.path().canonicalize().unwrap();
            let target = source.join(relative);
            fs::remove_file(&target).unwrap();
            if redirected {
                let outside = source.join("outside-reviewer-support");
                fs::write(&outside, "untrusted support").unwrap();
                symlink(&outside, &target).unwrap();
            }
            let home_directory = tempfile::tempdir().unwrap();
            let home = home_directory.path().canonicalize().unwrap();
            let personal = home.join(".claude/personal.txt");
            fs::create_dir_all(personal.parent().unwrap()).unwrap();
            fs::write(&personal, "retain").unwrap();
            status(command(&source, &home).output().unwrap(), 1);
            assert_eq!(fs::read(&personal).unwrap(), b"retain");
            assert!(!home.join(".claude/CLAUDE.md").exists());
            assert!(!home.join(".pi/agent/AGENTS.md").exists());
            assert!(
                !home
                    .join(".local/state/ai-config/installation.json")
                    .exists()
            );
        }
    }
}

#[test]
fn public_installer_refuses_an_incomplete_package_before_changing_either_harness() {
    let package = package();
    let source = package.path().canonicalize().unwrap();
    fs::remove_file(source.join("harnesses/pi/guard-policies.bundle.ts")).unwrap();
    let home_directory = tempfile::tempdir().unwrap();
    let home = home_directory.path().canonicalize().unwrap();
    for path in [".claude/CLAUDE.md", ".pi/agent/skills/commit"] {
        let link = home.join(path);
        fs::create_dir_all(link.parent().unwrap()).unwrap();
        symlink("/missing/unrecorded-legacy-resource", link).unwrap();
    }
    status(command(&source, &home).output().unwrap(), 1);
    for path in [".claude/CLAUDE.md", ".pi/agent/skills/commit"] {
        assert_eq!(
            fs::read_link(home.join(path)).unwrap(),
            Path::new("/missing/unrecorded-legacy-resource")
        );
    }
    assert!(
        !home
            .join(".local/state/ai-config/installation.json")
            .exists()
    );
}
