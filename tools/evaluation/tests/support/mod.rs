#![allow(dead_code)]
pub mod change;
pub mod consult;
pub mod package_fixture;
pub mod package_manifest;
pub mod reviewer;
pub mod shell_install;
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

fn fixture_binary() -> PathBuf {
    let test_binary = std::env::current_exe().expect("Locate the running Cargo test executable");
    test_binary
        .parent()
        .and_then(Path::parent)
        .expect("Cargo tests must run beneath the selected profile's deps directory")
        .join("examples/reviewer-fixture")
}

impl Trial {
    pub fn new() -> Self {
        let temporary = tempfile::tempdir().unwrap();
        let base = fs::canonicalize(temporary.path()).unwrap();
        let root = base.join("native trial π ' space");
        let home = base.join("native home π ' space");
        let binary = root.join("tools/evaluation/target/debug/reviewer-fixture");
        let fake_bin = base.join("fake-bin");
        let log = base.join("calls.jsonl");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::create_dir_all(&fake_bin).unwrap();
        fs::copy(fixture_binary(), &binary)
            .expect("Build reviewer-fixture with cargo build --example reviewer-fixture in the same target directory and profile first");
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
        let output = shell_install::command(&self.root, &self.home)
            .output()
            .unwrap();
        success(output);
    }

    pub fn assert_uninstalled(&self) {
        for relative in [
            ".claude/CLAUDE.md",
            ".pi/agent/AGENTS.md",
            ".local/bin",
            ".local/state/ai-config/installation.json",
        ] {
            assert!(
                !evaluation::paths::present(&self.home.join(relative)).unwrap(),
                "Unexpected installation: {relative}"
            );
        }
    }

    pub fn profile(&self) -> PathBuf {
        self.home.join(".local/state/ai-config/reviewer-pi")
    }

    pub fn command(&self) -> Command {
        self.configured_command(&self.binary)
    }

    pub fn rooted_command(&self) -> Command {
        let mut command = self.configured_command(fixture_binary());
        command.arg("--root").arg(&self.root);
        command
    }

    pub fn consult_command(&self) -> Command {
        self.configured_command(env!("CARGO_BIN_EXE_consult"))
    }

    fn configured_command(&self, binary: impl AsRef<std::ffi::OsStr>) -> Command {
        let mut command = Command::new(binary);
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
