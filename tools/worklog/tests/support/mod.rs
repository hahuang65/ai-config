use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tempfile::TempDir;

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
        git(&repo, &["init", "-q"]);
        let root = home.path().join("state");
        Self { home, repo, root }
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
