use crate::{shared_legacy, support};
use serde_json::Value;
use shared_legacy::SharedLegacyFixture;
use std::fs;
use std::os::unix::fs::symlink;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use support::package_fixture;

fn package() -> tempfile::TempDir {
    let source = package_fixture::fixture();
    package_fixture::manifest(source.path());
    fs::create_dir_all(source.path().join("profile")).unwrap();
    source
}

fn command(source: &Path, home: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_evaluation"));
    command
        .env("HOME", home)
        .arg("--root")
        .arg(source)
        .arg("native-install");
    command
}

fn legacy_options(fixture: &SharedLegacyFixture) -> Vec<PathBuf> {
    vec![
        fixture.source.clone(),
        fixture.upstream.clone(),
        fixture.agentmemory.clone(),
    ]
}

fn legacy_command(source: &Path, fixture: &SharedLegacyFixture) -> Command {
    let options = legacy_options(fixture);
    let mut command = command(source, &fixture.home);
    command.arg("--legacy-shared").arg(&options[0]);
    command.arg("--legacy-pi-subagents").arg(&options[1]);
    command.arg("--legacy-agentmemory").arg(&options[2]);
    command
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
fn help_and_invalid_flags_need_no_package_or_home_state() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap();
    let home = root.join("home");
    let output = command(&root, &home).arg("--help").output().unwrap();
    status(output, 0);
    for args in [
        &["--legacy-shared", "/temporary/source"][..],
        &["--legacy-worklog", "/temporary/source"],
        &[
            "--legacy-shared",
            "/temporary/source",
            "--legacy-shared",
            "/temporary/source",
        ],
        &["--unexpected", "/temporary/source"],
    ] {
        status(command(&root, &home).args(args).output().unwrap(), 2);
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
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let package = package();
    let source = package.path().canonicalize().unwrap();
    fs::remove_file(source.join("harnesses/pi/guard-policies.bundle.ts")).unwrap();
    let original = fs::read_link(fixture.home.join(".claude/CLAUDE.md")).unwrap();
    status(legacy_command(&source, &fixture).output().unwrap(), 1);
    assert_eq!(
        fs::read_link(fixture.home.join(".claude/CLAUDE.md")).unwrap(),
        original
    );
    assert!(
        !fixture
            .home
            .join(".local/state/ai-config/installation.json")
            .exists()
    );
    assert_eq!(
        fs::read_link(fixture.home.join(".pi/agent/skills/commit")).unwrap(),
        fixture.source.join("skills/commit")
    );
}

#[test]
fn public_installer_adopts_exact_old_links_and_repeats_without_losing_personal_state() {
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let package = package();
    let source = package.path().canonicalize().unwrap();
    let sentinel = fixture.home.join(".pi/agent/sessions/personal.json");
    fs::create_dir_all(sentinel.parent().unwrap()).unwrap();
    fs::write(&sentinel, "retained session").unwrap();
    let old_service_calls = fs::read(fixture.source.join("service-calls")).unwrap();

    status(legacy_command(&source, &fixture).output().unwrap(), 0);
    assert_eq!(
        fs::read_link(fixture.home.join(".claude/CLAUDE.md")).unwrap(),
        source.join("baseline.md")
    );
    assert_eq!(
        fs::read_link(fixture.home.join(".pi/agent/skills/commit")).unwrap(),
        source.join("skills/commit")
    );
    assert_eq!(fs::read(&sentinel).unwrap(), b"retained session");
    assert_eq!(
        fs::read(fixture.source.join("service-calls")).unwrap(),
        old_service_calls
    );
    let record: Value = serde_json::from_slice(
        &fs::read(
            fixture
                .home
                .join(".local/state/ai-config/installation.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(record["source"], source.to_str().unwrap());

    let claude_settings = fixture.home.join(".claude/settings.json");
    let mut settings: Value = serde_json::from_slice(&fs::read(&claude_settings).unwrap()).unwrap();
    settings["personalPreference"] = Value::String("keep me".into());
    fs::write(&claude_settings, serde_json::to_vec(&settings).unwrap()).unwrap();
    status(legacy_command(&source, &fixture).output().unwrap(), 0);
    let settings: Value = serde_json::from_slice(&fs::read(&claude_settings).unwrap()).unwrap();
    assert_eq!(settings["personalPreference"], "keep me");
    assert_eq!(fs::read(&sentinel).unwrap(), b"retained session");
}

#[test]
fn public_installer_adopts_coexisting_evaluation_links_without_touching_isolated_state() {
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let package = package();
    let source = package.path().canonicalize().unwrap();
    let evaluation = tempfile::tempdir().unwrap();
    let previous = evaluation.path().canonicalize().unwrap();
    let executable = previous.join("tools/evaluation/target/release/evaluation");
    let worktree = previous.join("tools/worktree");
    let worklog = previous.join("tools/worklog");
    for (name, target) in [
        ("pi-minimal", executable.clone()),
        ("review-change-eval", executable.clone()),
        ("artifact-review", previous.join("bin/artifact-review")),
        ("wt", worktree.join("target/release/wt")),
        ("wl", worklog.join("target/release/wl")),
        ("herdr-eval", executable.clone()),
    ] {
        symlink(target, fixture.home.join(".local/bin").join(name)).unwrap();
    }
    let history = previous.join(".state/pi/sessions/retained.jsonl");
    fs::create_dir_all(history.parent().unwrap()).unwrap();
    fs::write(&history, "independent evaluation history\n").unwrap();
    let mut command = legacy_command(&source, &fixture);
    command
        .arg("--legacy-evaluation")
        .arg(&previous)
        .arg("--legacy-evaluation-binary")
        .arg(&executable)
        .arg("--legacy-worktree")
        .arg(&worktree)
        .arg("--legacy-worklog")
        .arg(&worklog);
    status(command.arg("--check").output().unwrap(), 0);
    assert!(!fixture.home.join(".local/state/ai-config").exists());
    let mut command = legacy_command(&source, &fixture);
    command
        .arg("--legacy-evaluation")
        .arg(&previous)
        .arg("--legacy-evaluation-binary")
        .arg(&executable)
        .arg("--legacy-worktree")
        .arg(&worktree)
        .arg("--legacy-worklog")
        .arg(&worklog);
    status(command.output().unwrap(), 0);
    assert_eq!(
        fs::read_link(fixture.home.join(".local/bin/wt")).unwrap(),
        source.join("tools/worktree/target/release/wt")
    );
    assert_eq!(
        fs::read_link(fixture.home.join(".local/bin/herdr-eval")).unwrap(),
        executable
    );
    assert!(!fixture.home.join(".local/bin/pi-minimal").exists());
    assert_eq!(
        fs::read(history).unwrap(),
        b"independent evaluation history\n"
    );
}

#[test]
fn check_preflights_the_captured_installation_without_writing_a_record_or_detaching_links() {
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let package = package();
    let source = package.path().canonicalize().unwrap();
    let old_link = fs::read_link(fixture.home.join(".pi/agent/skills/commit")).unwrap();
    let old_settings = fs::read(fixture.home.join(".pi/agent/settings.json")).unwrap();
    let output = legacy_command(&source, &fixture)
        .arg("--check")
        .output()
        .unwrap();
    assert!(String::from_utf8_lossy(&output.stdout).contains("preflight"));
    status(output, 0);
    assert_eq!(
        fs::read_link(fixture.home.join(".pi/agent/skills/commit")).unwrap(),
        old_link
    );
    assert_eq!(
        fs::read(fixture.home.join(".pi/agent/settings.json")).unwrap(),
        old_settings
    );
    assert!(!fixture.home.join(".local/state/ai-config").exists());
}

#[test]
fn check_refuses_a_modified_old_link_and_incomplete_authority_without_home_writes() {
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let package = package();
    let source = package.path().canonicalize().unwrap();
    let instruction = fixture.home.join(".claude/CLAUDE.md");
    fs::remove_file(&instruction).unwrap();
    symlink(fixture.home.join("foreign"), &instruction).unwrap();
    status(
        legacy_command(&source, &fixture)
            .arg("--check")
            .output()
            .unwrap(),
        1,
    );
    status(
        command(&source, &fixture.home)
            .arg("--check")
            .output()
            .unwrap(),
        2,
    );
    assert_eq!(
        fs::read_link(instruction).unwrap(),
        fixture.home.join("foreign")
    );
    assert!(!fixture.home.join(".local/state/ai-config").exists());
}

#[test]
fn public_installer_refuses_an_edited_old_link_without_claiming_other_resources() {
    let fixture = SharedLegacyFixture::new();
    fixture.install_projection();
    let package = package();
    let source = package.path().canonicalize().unwrap();
    let path = fixture.home.join(".claude/CLAUDE.md");
    fs::remove_file(&path).unwrap();
    symlink(fixture.home.join("personal-instructions.md"), &path).unwrap();
    status(legacy_command(&source, &fixture).output().unwrap(), 1);
    assert_eq!(
        fs::read_link(path).unwrap(),
        fixture.home.join("personal-instructions.md")
    );
    assert!(
        !fixture
            .home
            .join(".local/state/ai-config/installation.json")
            .exists()
    );
    assert_eq!(
        fs::read_link(fixture.home.join(".pi/agent/skills/commit")).unwrap(),
        fixture.source.join("skills/commit")
    );
}
