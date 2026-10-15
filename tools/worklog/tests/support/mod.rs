use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tempfile::TempDir;

mod repository;

pub struct World {
    pub home: TempDir,
    pub repo: PathBuf,
    pub root: PathBuf,
}

impl World {
    pub fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let repo = home.path().join("project");
        std::fs::create_dir(&repo).unwrap();
        repository::initialize(&repo);
        let root = home.path().join("state");
        Self { home, repo, root }
    }

    // Query fixtures need valid history, not repeated process-level write checks.
    // Derive its schema/project/timestamp from one real write, then copy only data.
    pub fn seed_notes(&self, count: u64) {
        assert!(count > 0 && !self.root.exists());
        let mut entry = self.ok(&["note", "Reminder 0"])["entry"].clone();
        for id in 2..=count {
            entry["id"] = id.into();
            entry["task"] = id.into();
            entry["text"] = format!("Reminder {}", id - 1).into();
            std::fs::write(
                self.root.join("events").join(format!("{id:020}.json")),
                serde_json::to_vec(&entry).unwrap(),
            )
            .unwrap();
        }
    }

    pub fn command(&self, args: &[&str]) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_wl"));
        command
            .current_dir(&self.repo)
            .env("WL_ROOT", &self.root)
            .args(["--json"])
            .args(args);
        command
    }

    pub fn run(&self, args: &[&str]) -> Output {
        self.command(args).output().unwrap()
    }

    pub fn ok(&self, args: &[&str]) -> Value {
        let output = self.run(args);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(output.stderr.is_empty());
        serde_json::from_slice(&output.stdout).unwrap()
    }

    pub fn fail(&self, args: &[&str]) -> Output {
        let output = self.run(args);
        assert!(!output.status.success());
        assert!(output.stdout.is_empty());
        output
    }
}

pub fn git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(path)
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "git fixture failed");
}
