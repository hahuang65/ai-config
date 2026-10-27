use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
};

struct Project {
    _temp: tempfile::TempDir,
    root: PathBuf,
    trees: PathBuf,
    task: PathBuf,
}
impl Project {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("project");
        fs::create_dir(&root).unwrap();
        let p = Self {
            trees: root.parent().unwrap().join("trees"),
            task: root.parent().unwrap().join("trees/project/feature"),
            root,
            _temp: temp,
        };
        crate::repository::initialize(&p.root);
        p.ok(&p.root, &["new", "feature", "--local", "--json"]);
        p
    }
    fn git(&self, cwd: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(cwd)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "{}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8(out.stdout).unwrap().trim().into()
    }
    fn run(&self, cwd: &Path, args: &[&str]) -> Output {
        let bin = self.root.parent().unwrap().join("bin");
        let path = std::env::join_paths(
            std::iter::once(bin).chain(std::env::split_paths(&std::env::var_os("PATH").unwrap())),
        )
        .unwrap();
        Command::new(env!("CARGO_BIN_EXE_wt"))
            .args(args)
            .current_dir(cwd)
            .env("WT_ROOT", &self.trees)
            .env("PATH", path)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap()
    }
    fn ok(&self, cwd: &Path, args: &[&str]) -> Value {
        let out = self.run(cwd, args);
        assert!(
            out.status.success(),
            "{} {}",
            String::from_utf8_lossy(&out.stderr),
            String::from_utf8_lossy(&out.stdout)
        );
        serde_json::from_slice(&out.stdout).unwrap()
    }
}

#[path = "merged_cleanup.rs"]
mod merged;

#[test]
fn cleanup_deletes_the_integrated_local_branch_but_check_and_inside_do_not() {
    let p = Project::new();
    p.git(&p.task, &["commit", "--allow-empty", "-m", "feature"]);
    p.git(&p.root, &["merge", "--ff-only", "tu/feature"]);
    p.ok(&p.root, &["clean", "feature", "--check", "--json"]);
    p.ok(&p.task, &["clean", "feature", "--json"]);
    assert!(p.task.exists());
    assert!(
        !p.git(&p.root, &["branch", "--list", "tu/feature"])
            .is_empty()
    );
    let result = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(result["removed"], true);
    assert!(!p.task.exists());
    assert_eq!(p.git(&p.root, &["branch", "--list", "tu/feature"]), "");
    assert_eq!(result["branchRemoved"], true);
}

#[test]
fn branch_deletion_failure_reports_partial_cleanup_without_forcing_the_ref() {
    let p = Project::new();
    let lock = p.root.join(".git/refs/heads/tu/feature.lock");
    fs::write(&lock, "held by another Git operation").unwrap();
    let output = p.run(&p.root, &["clean", "feature", "--json"]);
    assert!(!output.status.success());
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["removed"], true);
    assert_eq!(result["branchRemoved"], false);
    assert_eq!(result["cleanupIncomplete"], true);
    assert!(!p.task.exists());
    assert!(
        !p.git(&p.root, &["branch", "--list", "tu/feature"])
            .is_empty()
    );
    assert!(lock.exists());
}

#[test]
fn claude_departure_requires_native_primary_cwd_and_reentry_restores_task_checks() {
    let p = Project::new();
    let command = |action| {
        vec![
            "session",
            action,
            "feature",
            "--harness",
            "claude",
            "--conversation",
            "saved-id",
        ]
    };
    p.ok(&p.task, &command("bind"));
    assert!(!p.run(&p.root, &command("verify")).status.success());
    assert!(!p.run(&p.task, &command("depart")).status.success());
    let other = [
        "session",
        "depart",
        "feature",
        "--harness",
        "claude",
        "--conversation",
        "other-id",
    ];
    assert!(!p.run(&p.root, &other).status.success());
    let left = p.ok(&p.root, &command("depart"));
    assert_eq!(left["atPrimary"], true);
    assert_eq!(left["conversation"], "saved-id");
    p.ok(&p.root, &command("verify"));
    assert!(!p.run(&p.task, &command("verify")).status.success());
    p.ok(&p.task, &command("bind"));
    p.ok(&p.task, &command("verify"));
    assert!(!p.run(&p.root, &command("verify")).status.success());
    assert!(p.task.exists());
}

#[test]
fn cleanup_uses_the_recorded_integration_branch_not_an_unrelated_upstream() {
    let p = Project::new();
    p.git(&p.root, &["branch", "unrelated"]);
    p.git(&p.task, &["commit", "--allow-empty", "-m", "feature"]);
    p.git(&p.task, &["branch", "--set-upstream-to=unrelated"]);
    p.git(&p.root, &["merge", "--ff-only", "tu/feature"]);
    let result = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(result["branchRemoved"], true);
    assert!(
        !p.git(&p.root, &["branch", "--list", "unrelated"])
            .is_empty()
    );
}
