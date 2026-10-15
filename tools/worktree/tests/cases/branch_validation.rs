use serde_json::Value;
use std::{collections::BTreeMap, fs, path::PathBuf, process::Command};

struct Project {
    home: tempfile::TempDir,
    root: PathBuf,
    trees: PathBuf,
}

impl Project {
    fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().canonicalize().unwrap().join("project");
        fs::create_dir(&root).unwrap();
        crate::repository::initialize(&root);
        let trees = root.parent().unwrap().join("trees");
        let project = Self { home, root, trees };
        let output = project
            .command()
            .args(["new", "feature", "--local", "--json"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        project
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_wt"));
        command
            .current_dir(&self.root)
            .env("WT_ROOT", &self.trees)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1");
        command
    }
}

#[test]
fn each_invocation_validates_repeated_branch_names_once_without_a_persistent_cache() {
    let project = Project::new();
    for invocation in 0..2 {
        let trace = project.home.path().join(format!("git-{invocation}.jsonl"));
        let output = project
            .command()
            .env("GIT_TRACE2_EVENT", &trace)
            .args(["session", "inspect", "feature", "--harness", "claude"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let mut checks = BTreeMap::new();
        for line in fs::read_to_string(trace).unwrap().lines() {
            let event: Value = serde_json::from_str(line).unwrap();
            if event["event"] == "start" && event["argv"][2] == "check-ref-format" {
                *checks
                    .entry(event["argv"][3].as_str().unwrap().to_owned())
                    .or_insert(0) += 1;
            }
        }
        assert_eq!(
            checks,
            BTreeMap::from([
                ("refs/heads/main".to_owned(), 1),
                ("refs/heads/tu/feature".to_owned(), 1),
            ])
        );
    }
}
