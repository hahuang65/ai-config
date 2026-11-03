use super::Shell;
use std::{fs, os::unix::fs::PermissionsExt};

#[test]
fn leave_needs_no_repository_write_access_or_administrative_files() {
    let shell = Shell::new();
    let admin = shell.cwd.join(".git");
    let lock = admin.join("wt-operation.lock");
    assert!(!lock.exists());
    let before: std::collections::BTreeSet<_> = fs::read_dir(&admin)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    let permissions = fs::metadata(&admin).unwrap().permissions();
    fs::set_permissions(&admin, fs::Permissions::from_mode(0o555)).unwrap();
    let result = shell.command().args(["leave", "--json"]).output();
    fs::set_permissions(&admin, permissions).unwrap();
    let output = result.unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let document: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(document["project"]["root"], shell.cwd.to_str().unwrap());
    assert!(output.stderr.is_empty());
    assert!(!lock.exists());
    let after: std::collections::BTreeSet<_> = fs::read_dir(&admin)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(after, before);
    assert!(!shell.trees.exists());
}

#[test]
fn leave_does_not_contend_for_a_mutation_lock_but_list_still_does() {
    use std::os::fd::AsRawFd;
    let shell = Shell::new();
    let lock = fs::File::create(shell.cwd.join(".git/wt-operation.lock")).unwrap();
    // SAFETY: the live descriptor belongs to this disposable repository fixture.
    assert_eq!(
        unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
        0
    );
    let output = shell.command().args(["leave", "--json"]).output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    let blocked = shell.command().args(["list", "--json"]).output().unwrap();
    assert!(!blocked.status.success());
    assert!(String::from_utf8_lossy(&blocked.stderr).contains("Another wt operation"));
}

#[test]
fn leave_validates_arguments_and_help_before_repository_access() {
    let shell = Shell::new();
    for arguments in [
        ["leave", "unexpected"],
        ["leave", "--check"],
        ["leave", "--json=value"],
    ] {
        let output = shell
            .command()
            .current_dir(shell.home.path())
            .args(arguments)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(!output.stderr.is_empty());
    }
    let output = shell
        .command()
        .current_dir(shell.home.path())
        .args(["leave", "--help"])
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("primary checkout")
    );
    assert!(output.stderr.is_empty());
    assert!(!shell.trees.exists());
}

#[test]
fn leave_json_reports_primary_without_changing_the_shell_directory() {
    let shell = Shell::new();
    let target = shell.create("feature");
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "source \"$WT_SETUP\"; builtin cd -- \"$2\" || exit; \"$1\" leave --json || exit; printf 'PWD:%s\\n' \"$PWD\"",
            &[name, target.to_str().unwrap()],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8(output.stdout).unwrap();
        let (document, directory) = stdout.split_once("\nPWD:").unwrap();
        let value: serde_json::Value = serde_json::from_str(document).unwrap();
        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["command"], "leave");
        assert_eq!(value["transition"]["kind"], "return-main");
        assert_eq!(
            value["transition"]["targetPath"],
            shell.cwd.to_str().unwrap()
        );
        assert_eq!(directory, format!("{}\n", target.display()));
        assert!(output.stderr.is_empty());
    }
}

#[test]
fn command_leave_only_prints_the_primary_path_and_plain_leave_is_idempotent() {
    let shell = Shell::new();
    let target = shell.create("feature");
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "source \"$WT_SETUP\"; builtin cd -- \"$2\" || exit; command \"$1\" leave || exit; printf 'PWD:%s\\n' \"$PWD\"; \"$1\" leave || exit; \"$1\" leave || exit; printf 'PRIMARY:%s\\n' \"$PWD\"",
            &[name, target.to_str().unwrap()],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            output.stdout,
            format!(
                "{}\nPWD:{}\nPRIMARY:{}\n",
                shell.cwd.display(),
                target.display(),
                shell.cwd.display()
            )
            .as_bytes()
        );
        assert!(output.stderr.is_empty());
    }
    let output = shell.command().args(["leave", "--json"]).output().unwrap();
    assert!(output.status.success());
    let value: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(value["transition"]["kind"], "none");
}

#[test]
fn leave_treats_primary_paths_literally_and_uses_builtin_cd() {
    let mut shell = Shell::new();
    let original = shell.cwd.clone();
    shell.cwd = shell
        .home
        .path()
        .canonicalize()
        .unwrap()
        .join("primary $(touch injected); 'quotes' [literal]\nnext");
    fs::rename(original, &shell.cwd).unwrap();
    let target = shell.create("feature");
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "set -euo pipefail; source \"$WT_SETUP\"; cd() { return 87; }; export CDPATH=/; builtin cd -- \"$2\"; \"$1\" leave --; printf '%s\\n' \"$PWD\"",
            &[name, target.to_str().unwrap()],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            output.stdout,
            format!("{}\n", shell.cwd.display()).as_bytes()
        );
        assert!(output.stderr.is_empty());
        assert!(!target.join("injected").exists());
        assert!(!shell.cwd.join("injected").exists());
    }
}

#[test]
fn leave_preserves_trailing_newlines_in_the_primary_path() {
    let mut shell = Shell::new();
    let original = shell.cwd.clone();
    let prefix = shell.home.path().canonicalize().unwrap().join("primary");
    fs::create_dir(&prefix).unwrap();
    shell.cwd = prefix.with_file_name("primary\n\n");
    fs::rename(original, &shell.cwd).unwrap();
    let target = shell.create("feature");
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "source \"$WT_SETUP\"; builtin cd -- \"$2\" || exit; \"$1\" leave || exit; builtin printf '%s\\0' \"$PWD\"",
            &[name, target.to_str().unwrap()],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            output.stdout,
            format!("{}\0", shell.cwd.display()).as_bytes()
        );
        assert!(output.stderr.is_empty());
        assert!(target.is_dir());
    }
}

#[test]
fn documented_quickstart_preserves_trailing_newlines_in_the_primary_path() {
    let mut shell = Shell::new();
    let original = shell.cwd.clone();
    let prefix = shell.home.path().canonicalize().unwrap().join("primary");
    fs::create_dir(&prefix).unwrap();
    shell.cwd = prefix.with_file_name("primary\n\n");
    fs::rename(original, &shell.cwd).unwrap();
    let guide = include_str!("../../README.md");
    let usage = guide.split("## Use\n").nth(1).unwrap();
    let block = usage.split("```").nth(1).unwrap();
    let (_, example) = block.split_once('\n').unwrap();
    let (entry, returning) = example.split_once("wt list\n").unwrap();
    let task = shell.trees.join("shell-fixture/invoice-search");
    let output = shell.bash(
        &format!("set -e\n{entry}[[ $PWD == \"$1\" ]]\nwt list\n{returning}\nbuiltin printf '\\0%s\\0' \"$PWD\""),
        &[task.to_str().unwrap()],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output
            .stdout
            .ends_with(format!("\0{}\0", shell.cwd.display()).as_bytes())
    );
}

#[test]
fn leave_discovers_a_primary_checkout_containing_a_carriage_return() {
    let mut shell = Shell::new();
    let original = shell.cwd.clone();
    shell.cwd = shell
        .home
        .path()
        .canonicalize()
        .unwrap()
        .join("primary\rnotes");
    fs::rename(original, &shell.cwd).unwrap();
    let target = shell
        .home
        .path()
        .canonicalize()
        .unwrap()
        .join("manual task");
    let mut git = std::process::Command::new("git");
    shell.environment(&mut git);
    let created = git
        .args(["worktree", "add", "--detach", "--"])
        .arg(&target)
        .output()
        .unwrap();
    assert!(
        created.status.success(),
        "{}",
        String::from_utf8_lossy(&created.stderr)
    );
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "source \"$WT_SETUP\"; builtin cd -- \"$2\" || exit; \"$1\" leave || exit; builtin printf '%s\\0' \"$PWD\"",
            &[name, target.to_str().unwrap()],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            output.stdout,
            format!("{}\0", shell.cwd.display()).as_bytes()
        );
        assert!(output.stderr.is_empty());
        assert!(target.is_dir());
    }
}

#[test]
fn leave_returns_from_a_dirty_task_subdirectory_without_cleanup() {
    let shell = Shell::new();
    let target = shell.create("feature");
    let nested = target.join("nested directory");
    fs::create_dir(&nested).unwrap();
    fs::write(target.join("notes.txt"), "unfinished work").unwrap();
    for name in ["wt", "worktree"] {
        let output = shell.bash(
            "source \"$WT_SETUP\"; builtin cd -- \"$2\" || exit; \"$1\" leave || exit; printf '%s\\n' \"$PWD\"",
            &[name, nested.to_str().unwrap()],
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert_eq!(
            output.stdout,
            format!("{}\n", shell.cwd.display()).as_bytes()
        );
        assert!(output.stderr.is_empty());
        assert_eq!(
            fs::read_to_string(target.join("notes.txt")).unwrap(),
            "unfinished work"
        );
        assert!(
            shell
                .command()
                .args(["enter", "feature"])
                .output()
                .unwrap()
                .status
                .success()
        );
    }
}
