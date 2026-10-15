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
        crate::repository::initialize(&root);
        let trees = root.parent().unwrap().join("trees");
        let task = trees.join("project/feature");
        let project = Self {
            _temp: temp,
            root,
            trees,
            task,
        };
        project.ok(&project.root, &["new", "feature", "--local", "--json"]);
        project
    }
    fn run(&self, cwd: &Path, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_wt"))
            .args(args)
            .current_dir(cwd)
            .env("WT_ROOT", &self.trees)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap()
    }
    fn ok(&self, cwd: &Path, args: &[&str]) -> Value {
        let result = self.run(cwd, args);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
        serde_json::from_slice(&result.stdout).unwrap()
    }
    fn conversation(&self, cwd: &Path, action: &str, conversation: &str) -> Output {
        self.run(
            cwd,
            &[
                "session",
                action,
                "feature",
                "--harness",
                "pi",
                "--conversation",
                conversation,
            ],
        )
    }
}

#[test]
fn task_conversation_binding_needs_no_owner_and_does_not_lock_the_worktree() {
    let p = Project::new();
    let args = [
        "session",
        "bind",
        "feature",
        "--harness",
        "pi",
        "--conversation",
        "/sessions/first.jsonl",
    ];
    assert!(!p.run(&p.root, &args).status.success());
    p.ok(&p.task, &args);
    // A different CLI process can verify or resume the same reference without a claim.
    assert!(
        p.conversation(&p.task, "verify", "/sessions/first.jsonl")
            .status
            .success()
    );
    let inventory = p.ok(&p.root, &["list", "--all", "--json"]);
    assert!(
        inventory["worktrees"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["locked"] == false)
    );
    p.ok(&p.root, &["enter", "feature", "--json"]);
    assert!(
        !p.conversation(&p.task, "bind", "/sessions/different.jsonl")
            .status
            .success()
    );
    assert!(
        !p.conversation(&p.task, "verify", "/sessions/different.jsonl")
            .status
            .success()
    );
    let saved = p.ok(
        &p.root,
        &["session", "inspect", "feature", "--harness", "pi"],
    );
    assert_eq!(saved["conversation"], "/sessions/first.jsonl");
}

#[test]
fn a_saved_conversation_locates_its_task_even_when_the_harness_is_in_the_wrong_checkout() {
    let p = Project::new();
    assert!(
        p.conversation(&p.task, "bind", "/sessions/first.jsonl")
            .status
            .success()
    );
    let located = p.ok(
        &p.root,
        &[
            "session",
            "locate",
            "--harness",
            "pi",
            "--conversation",
            "/sessions/first.jsonl",
        ],
    );
    assert_eq!(located["worktree"]["path"], p.task.to_str().unwrap());
}

#[test]
fn unrelated_conversations_do_not_require_task_creation_configuration() {
    let p = Project::new();
    let ordinary = p.root.parent().unwrap().join("my.project");
    fs::create_dir(&ordinary).unwrap();
    assert!(
        Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(&ordinary)
            .output()
            .unwrap()
            .status
            .success()
    );
    let located = p.ok(
        &ordinary,
        &[
            "session",
            "locate",
            "--harness",
            "claude",
            "--conversation",
            "ordinary-session",
        ],
    );
    assert!(located["worktree"].is_null());
}

#[test]
fn damaged_references_do_not_block_unrelated_lookup_but_selected_checks_stay_strict() {
    use std::os::unix::fs::symlink;
    let p = Project::new();
    assert!(
        p.conversation(&p.task, "bind", "/sessions/first.jsonl")
            .status
            .success()
    );
    let output = Command::new("git")
        .args([
            "rev-parse",
            "--path-format=absolute",
            "--git-path",
            "wt-session-pi.json",
        ])
        .current_dir(&p.task)
        .output()
        .unwrap();
    assert!(output.status.success());
    let record = PathBuf::from(String::from_utf8(output.stdout).unwrap().trim());
    let elsewhere = p.root.parent().unwrap().join("do-not-follow");
    fs::write(&elsewhere, "PRIVATE_MARKER").unwrap();
    for redirected in [false, true] {
        if redirected {
            fs::remove_file(&record).unwrap();
            symlink(&elsewhere, &record).unwrap();
        } else {
            fs::write(&record, "{partial PRIVATE_MARKER").unwrap();
        }
        assert_damaged_reference_is_isolated(&p);
    }
}

fn assert_damaged_reference_is_isolated(p: &Project) {
    let lookup = p.run(
        &p.root,
        &[
            "session",
            "locate",
            "--harness",
            "pi",
            "--conversation",
            "manual-conversation",
        ],
    );
    assert!(
        lookup.status.success(),
        "{}",
        String::from_utf8_lossy(&lookup.stderr)
    );
    assert!(serde_json::from_slice::<Value>(&lookup.stdout).unwrap()["worktree"].is_null());
    let diagnostic = String::from_utf8_lossy(&lookup.stderr);
    assert!(diagnostic.contains("Skipped unreadable conversation reference"));
    assert!(!diagnostic.contains("PRIVATE_MARKER"));
    assert!(
        !p.run(
            &p.root,
            &["session", "inspect", "feature", "--harness", "pi"]
        )
        .status
        .success()
    );
    assert!(
        !p.conversation(&p.task, "verify", "/sessions/first.jsonl")
            .status
            .success()
    );
    assert!(
        !p.conversation(&p.task, "bind", "/sessions/replacement.jsonl")
            .status
            .success()
    );
}

#[test]
fn session_protocol_has_no_claim_release_or_owner_arguments() {
    let p = Project::new();
    for action in ["claim", "release"] {
        assert_eq!(
            p.conversation(&p.task, action, "/sessions/first.jsonl")
                .status
                .code(),
            Some(2)
        );
    }
    assert_eq!(
        p.run(
            &p.task,
            &[
                "session",
                "bind",
                "feature",
                "--harness",
                "pi",
                "--owner",
                "obsolete",
                "--conversation",
                "/sessions/first.jsonl"
            ]
        )
        .status
        .code(),
        Some(2)
    );
}

#[test]
fn saved_conversation_checks_do_not_contend_for_the_repository_operation_lock() {
    use std::os::fd::AsRawFd;
    let p = Project::new();
    assert!(
        p.conversation(&p.task, "bind", "/sessions/first.jsonl")
            .status
            .success()
    );
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(p.root.join(".git/wt-operation.lock"))
        .unwrap();
    // SAFETY: the descriptor stays open for the duration of the subprocess checks.
    assert_eq!(
        unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
        0
    );
    p.ok(
        &p.root,
        &["session", "inspect", "feature", "--harness", "pi"],
    );
    p.ok(
        &p.root,
        &[
            "session",
            "locate",
            "--harness",
            "pi",
            "--conversation",
            "/sessions/first.jsonl",
        ],
    );
    assert!(
        p.conversation(&p.task, "verify", "/sessions/first.jsonl")
            .status
            .success()
    );
}

#[test]
fn saved_references_do_not_take_or_release_manual_git_locks() {
    let p = Project::new();
    assert!(
        Command::new("git")
            .args(["worktree", "lock", "--reason", "manual retention"])
            .arg(&p.task)
            .current_dir(&p.root)
            .output()
            .unwrap()
            .status
            .success()
    );
    assert!(
        p.conversation(&p.task, "bind", "/sessions/first.jsonl")
            .status
            .success()
    );
    assert!(
        p.conversation(&p.task, "verify", "/sessions/first.jsonl")
            .status
            .success()
    );
    let inventory = p.ok(&p.root, &["list", "--all", "--json"]);
    let task = inventory["worktrees"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["task"] == "feature")
        .unwrap();
    assert_eq!(task["lockReason"], "manual retention");
}
