use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::PathBuf,
    process::{Command, Output},
};

struct Shell {
    home: tempfile::TempDir,
    cwd: PathBuf,
    bin: PathBuf,
    trees: PathBuf,
}

impl Shell {
    fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let root = home.path().canonicalize().unwrap();
        let cwd = root.join("project with spaces");
        fs::create_dir(&cwd).unwrap();
        crate::repository::initialize(&cwd);
        let bin = root.join("bin with spaces");
        fs::create_dir(&bin).unwrap();
        for name in ["wt", "worktree"] {
            symlink(env!("CARGO_BIN_EXE_wt"), bin.join(name)).unwrap();
        }
        let shell = Self {
            home,
            cwd,
            bin,
            trees: root.join("trees with spaces"),
        };
        let mut git = Command::new("git");
        shell.environment(&mut git);
        assert!(
            git.args(["config", "wt.project", "shell-fixture"])
                .status()
                .unwrap()
                .success()
        );
        shell
    }

    fn environment(&self, command: &mut Command) {
        command
            .current_dir(&self.cwd)
            .env("HOME", self.home.path())
            .env("WT_ROOT", &self.trees)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env_remove("BASH_ENV")
            .env_remove("ENV");
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_wt"));
        self.environment(&mut command);
        command
    }

    fn create(&self, task: &str) -> PathBuf {
        let output = self
            .command()
            .args(["new", task, "--local", "--json"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        PathBuf::from(value["worktree"]["path"].as_str().unwrap())
    }

    fn bash(&self, script: &str, args: &[&str]) -> Output {
        let setup = self
            .command()
            .args(["shell-init", "bash"])
            .output()
            .unwrap();
        assert!(
            setup.status.success(),
            "{}",
            String::from_utf8_lossy(&setup.stderr)
        );
        let file = self.home.path().join("integration.bash");
        fs::write(&file, setup.stdout).unwrap();
        let mut command = Command::new("bash");
        self.environment(&mut command);
        command
            .args(["--noprofile", "--norc", "-c", script, "wt-shell-test"])
            .args(args)
            .env("WT_SETUP", file)
            .env(
                "PATH",
                format!("{}:{}", self.bin.display(), std::env::var("PATH").unwrap()),
            );
        command.output().unwrap()
    }
}

#[test]
fn machine_output_help_and_errors_pass_through_without_changing_directory() {
    let shell = Shell::new();
    shell.create("feature");
    for name in ["wt", "worktree"] {
        for args in [
            vec!["enter", "feature", "--json"],
            vec!["enter", "--json", "feature"],
            vec!["enter", "--help"],
            vec!["enter", "-hh"],
            vec!["enter", "missing"],
            vec!["enter"],
            vec!["enter", "$(touch injected)"],
            vec!["list", "--json"],
            vec![],
        ] {
            let mut command = Command::new(shell.bin.join(name));
            shell.environment(&mut command);
            let raw = command.args(&args).output().unwrap();
            let mut arguments = vec![name];
            arguments.extend_from_slice(&args);
            let output = shell.bash(
                "source \"$WT_SETUP\"; \"$@\"; result=$?; printf '\\nSTATUS:%s\\nPWD:%s\\n' \"$result\" \"$PWD\"",
                &arguments,
            );
            let mut expected = raw.stdout;
            expected.extend(
                format!(
                    "\nSTATUS:{}\nPWD:{}\n",
                    raw.status.code().unwrap(),
                    shell.cwd.display()
                )
                .as_bytes(),
            );
            assert!(output.status.success());
            assert_eq!(output.stdout, expected, "{name} {args:?}");
            assert_eq!(output.stderr, raw.stderr, "{name} {args:?}");
        }
    }
    assert!(!shell.cwd.join("injected").exists());
}

#[test]
fn setup_validates_before_repository_access_without_installing_anything() {
    let shell = Shell::new();
    for args in [
        vec!["shell-init"],
        vec!["shell-init", "zsh"],
        vec!["shell-init", "bash", "--json"],
    ] {
        let output = shell
            .command()
            .current_dir(shell.home.path())
            .args(args)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(
            String::from_utf8(output.stderr)
                .unwrap()
                .contains("shell-init bash")
        );
    }
    for args in [
        vec!["shell-init", "--help"],
        vec!["shell-init", "bash", "-h"],
        vec!["shell-init", "bash"],
    ] {
        let output = shell
            .command()
            .current_dir(shell.home.path())
            .args(args)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(!output.stdout.is_empty());
        assert!(output.stderr.is_empty());
    }
    assert!(!shell.trees.exists());
    assert!(!shell.home.path().join(".bashrc").exists());
    assert!(!shell.home.path().join(".git").exists());
}

#[test]
fn shell_setup_is_discoverable_in_help_and_completes_in_the_wrapped_shell() {
    let shell = Shell::new();
    let help = shell.command().arg("--help").output().unwrap();
    assert!(help.status.success());
    assert!(
        String::from_utf8(help.stdout)
            .unwrap()
            .contains("wt shell-init bash")
    );
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "source \"$WT_SETUP\"; source <(command wt completions bash); COMP_WORDS=(\"$1\" shell-init b); COMP_CWORD=2; _wt_complete; for word in \"${COMPREPLY[@]}\"; do printf '%s\\n' \"$word\"; done",
            &[name],
        );
        assert!(output.status.success());
        assert_eq!(output.stdout, b"bash\n");
        assert!(output.stderr.is_empty());
    }
    assert!(!shell.trees.exists());
}

#[test]
fn directory_change_failure_is_nonzero_and_retains_the_original_directory() {
    let mut shell = Shell::new();
    shell.bin = shell.home.path().join("fake-bin");
    fs::create_dir(&shell.bin).unwrap();
    for name in ["wt", "worktree"] {
        let fake = shell.bin.join(name);
        fs::write(
            &fake,
            "#!/bin/sh\nprintf '%s\\n' \"$HOME/no such worktree\"\n",
        )
        .unwrap();
        fs::set_permissions(fake, fs::Permissions::from_mode(0o755)).unwrap();
        let output = shell.bash(
            "source \"$WT_SETUP\"; \"$1\" enter feature; result=$?; printf 'STATUS:%s\\nPWD:%s\\n' \"$result\" \"$PWD\"",
            &[name],
        );
        assert_eq!(
            output.stdout,
            format!("STATUS:1\nPWD:{}\n", shell.cwd.display()).as_bytes()
        );
        assert!(!output.stderr.is_empty());
    }
}

#[test]
fn new_still_creates_without_entering_and_command_bypasses_the_wrapper() {
    for name in ["wt", "worktree"] {
        let shell = Shell::new();
        let output = shell.bash(
            "source \"$WT_SETUP\"; \"$1\" new feature --local --json || exit; printf 'PWD:%s\\n' \"$PWD\"; command \"$1\" enter feature",
            &[name],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8(output.stdout).unwrap();
        let (json, rest) = stdout.split_once("\nPWD:").unwrap();
        let value: serde_json::Value = serde_json::from_str(json).unwrap();
        let target = value["worktree"]["path"].as_str().unwrap();
        assert_eq!(value["command"], "new");
        assert_eq!(rest, format!("{}\n{target}\n", shell.cwd.display()));
        assert!(PathBuf::from(target).is_dir());
    }
}

#[test]
fn locked_tasks_do_not_change_the_calling_directory() {
    let shell = Shell::new();
    let target = shell.create("feature");
    let mut git = Command::new("git");
    shell.environment(&mut git);
    assert!(
        git.args(["worktree", "lock"])
            .arg(target)
            .status()
            .unwrap()
            .success()
    );
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "source \"$WT_SETUP\"; \"$1\" enter feature; result=$?; printf 'STATUS:%s\\nPWD:%s\\n' \"$result\" \"$PWD\"",
            &[name],
        );
        assert_eq!(
            output.stdout,
            format!("STATUS:1\nPWD:{}\n", shell.cwd.display()).as_bytes()
        );
        assert!(
            String::from_utf8(output.stderr)
                .unwrap()
                .contains("locked by Git")
        );
    }
}

#[test]
fn entry_treats_paths_literally_and_ignores_cd_functions_and_cdpath() {
    let mut shell = Shell::new();
    shell.trees = shell
        .home
        .path()
        .canonicalize()
        .unwrap()
        .join("trees $(touch injected); 'quotes' [literal]\nnext");
    let target = shell.create("feature");
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "set -euo pipefail; source \"$WT_SETUP\"; source \"$WT_SETUP\"; cd() { return 87; }; export CDPATH=/; \"$1\" enter -- feature; printf '%s\\n' \"$PWD\"",
            &[name],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(output.stdout, format!("{}\n", target.display()).as_bytes());
        assert!(output.stderr.is_empty());
        assert!(!shell.cwd.join("injected").exists());
    }
}

#[test]
fn enter_changes_the_calling_bash_directory_for_both_names() {
    let shell = Shell::new();
    let target = shell.create("feature");
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "source \"$WT_SETUP\"; \"$1\" enter feature || exit; printf '%s\\n' \"$PWD\"",
            &[name],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(output.stdout, format!("{}\n", target.display()).as_bytes());
        assert!(output.stderr.is_empty());
    }
}
