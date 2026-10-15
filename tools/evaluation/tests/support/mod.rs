#![allow(dead_code)]
pub mod change;
pub mod consult;
pub mod package_fixture;
pub mod reviewer;
use serde_json::{Value, json};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use tempfile::TempDir;

pub struct Trial {
    pub temporary: TempDir,
    pub root: PathBuf,
    pub home: PathBuf,
    pub binary: PathBuf,
    pub fake_bin: PathBuf,
    pub log: PathBuf,
}

pub fn put(path: impl AsRef<Path>, contents: impl AsRef<[u8]>) {
    fs::create_dir_all(path.as_ref().parent().unwrap()).unwrap();
    fs::write(path, contents).unwrap();
}

pub fn executable(path: impl AsRef<Path>, contents: &str) {
    put(&path, contents);
    fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
}

impl Trial {
    pub fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temporary.path()).unwrap();
        let root = base.join("native trial π ' space");
        let home = base.join("native home π ' space");
        let binary = root.join("tools/evaluation/target/debug/evaluation");
        let fake_bin = base.join("fake-bin");
        let log = base.join("calls.jsonl");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::create_dir_all(&fake_bin).unwrap();
        fs::copy(env!("CARGO_BIN_EXE_evaluation"), &binary).unwrap();
        package_fixture::populate(&root);
        package_fixture::manifest(&root);
        put(root.join("reviewer.md"), "restricted review fixture\n");
        put(root.join("harnesses/pi/review-scope.ts"), "scope fixture\n");
        fs::create_dir_all(home.join(".pi/agent")).unwrap();
        put(
            home.join(".pi/agent/settings.json"),
            json!({
                "defaultProvider": "opencode", "defaultModel": "fixture"
            })
            .to_string(),
        );
        Self {
            temporary,
            root,
            home,
            binary,
            fake_bin,
            log,
        }
    }

    pub fn install(&self) {
        let output = Command::new(env!("CARGO_BIN_EXE_ai-config"))
            .env("HOME", &self.home)
            .args(["--root"])
            .arg(&self.root)
            .arg("install")
            .output()
            .unwrap();
        success(output);
    }

    pub fn profile(&self) -> PathBuf {
        self.home.join(".local/state/ai-config/reviewer-pi")
    }

    pub fn command(&self) -> Command {
        let mut command = Command::new(&self.binary);
        command
            .env("HOME", &self.home)
            .env(
                "PATH",
                format!(
                    "{}:{}",
                    self.fake_bin.display(),
                    std::env::var("PATH").unwrap()
                ),
            )
            .env("EVALUATION_TEST_LOG", &self.log);
        command
    }

    pub fn run(&self, args: &[&str]) -> Output {
        self.command().args(args).output().unwrap()
    }

    pub fn calls(&self) -> Vec<Value> {
        match fs::read_to_string(&self.log) {
            Ok(log) => log
                .lines()
                .map(|line| serde_json::from_str(line).unwrap())
                .collect(),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => vec![],
            Err(error) => panic!("Cannot read fixture calls: {error}"),
        }
    }
}

pub fn read_json(path: impl AsRef<Path>) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

pub fn success(output: Output) {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
