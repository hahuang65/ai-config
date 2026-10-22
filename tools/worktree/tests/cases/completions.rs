use std::{
    collections::BTreeMap,
    fs,
    os::fd::AsRawFd,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::SystemTime,
};

struct Shell {
    home: tempfile::TempDir,
    cwd: PathBuf,
    trees: PathBuf,
}

impl Shell {
    fn new() -> Self {
        let home = tempfile::tempdir().unwrap();
        let cwd = home
            .path()
            .canonicalize()
            .unwrap()
            .join("project with spaces");
        fs::create_dir(&cwd).unwrap();
        let trees = cwd.parent().unwrap().join("trees");
        Self { home, cwd, trees }
    }

    fn project(tasks: &[&str]) -> Self {
        let shell = Self::new();
        crate::repository::initialize(&shell.cwd);
        shell.git(&["config", "wt.project", "completion-fixture"]);
        for task in tasks {
            let output = shell
                .command()
                .args(["new", task, "--local", "--json"])
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        shell
    }

    fn command(&self) -> Command {
        let mut command = Command::new(env!("CARGO_BIN_EXE_wt"));
        command
            .current_dir(&self.cwd)
            .env("HOME", self.home.path())
            .env("WT_ROOT", &self.trees)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1");
        command
    }

    fn git(&self, args: &[&str]) {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.cwd)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }

    fn complete(&self, words: &[&str]) -> Output {
        self.complete_as(Path::new(env!("CARGO_BIN_EXE_wt")), words)
    }

    fn complete_as(&self, program: &Path, words: &[&str]) -> Output {
        let generated = self
            .command()
            .args(["completions", "bash"])
            .output()
            .unwrap();
        assert!(
            generated.status.success(),
            "{}",
            String::from_utf8_lossy(&generated.stderr)
        );
        let script = String::from_utf8(generated.stdout).unwrap()
            + "\ncomplete -p wt worktree >/dev/null || exit 17\nCOMP_WORDS=(\"$@\")\nCOMP_CWORD=$WT_TEST_CWORD\n_wt_complete\nfor candidate in \"${COMPREPLY[@]}\"; do printf '%s\\n' \"$candidate\"; done\n";
        Command::new("bash")
            .args(["--noprofile", "--norc", "-c", &script, "wt-completion-test"])
            .arg(program)
            .args(words)
            .current_dir(&self.cwd)
            .env("HOME", self.home.path())
            .env_remove("BASH_ENV")
            .env_remove("ENV")
            .env("WT_ROOT", &self.trees)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1")
            .env("WT_TEST_CWORD", words.len().to_string())
            .output()
            .unwrap()
    }
}

fn candidates(output: Output) -> Vec<String> {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        output.stderr.is_empty(),
        "Completion must not print diagnostics"
    );
    String::from_utf8(output.stdout)
        .unwrap()
        .lines()
        .map(str::to_owned)
        .collect()
}

#[test]
fn enter_and_clean_complete_current_project_managed_task_names() {
    let shell = Shell::project(&["feature-one", "feature-two", "OtherTask"]);
    assert_eq!(
        candidates(shell.complete(&["enter", "feature-"])),
        ["feature-one", "feature-two"]
    );
    assert_eq!(
        candidates(shell.complete(&["clean", "feature-"])),
        ["feature-one", "feature-two"]
    );
    assert_eq!(
        candidates(shell.complete(&["enter", "Other"])),
        ["OtherTask"]
    );
}

#[test]
fn task_names_still_complete_after_flags_and_the_option_terminator() {
    let shell = Shell::project(&["feature"]);
    for words in [
        ["enter", "--json", "fea"],
        ["clean", "--check", "fea"],
        ["enter", "--", "fea"],
    ] {
        assert_eq!(candidates(shell.complete(&words)), ["feature"]);
    }
}

#[test]
fn bash_does_not_suggest_flags() {
    let shell = Shell::new();
    for words in [
        ["--h"].as_slice(),
        ["clean", "--ch"].as_slice(),
        ["new", "--l"].as_slice(),
        ["enter", "--j"].as_slice(),
        ["list", "--a"].as_slice(),
        ["list", ""].as_slice(),
        ["new", ""].as_slice(),
        ["completions", "bash", ""].as_slice(),
    ] {
        assert!(candidates(shell.complete(words)).is_empty(), "{words:?}");
    }
    assert!(!shell.trees.exists());
}

fn state(root: &Path) -> BTreeMap<PathBuf, (Vec<u8>, SystemTime)> {
    let mut result = BTreeMap::new();
    for item in fs::read_dir(root).unwrap() {
        let item = item.unwrap();
        if item.file_type().unwrap().is_dir() {
            result.extend(state(&item.path()));
        } else {
            result.insert(
                item.path(),
                (
                    fs::read(item.path()).unwrap(),
                    item.metadata().unwrap().modified().unwrap(),
                ),
            );
        }
    }
    result
}

#[test]
fn task_completion_is_read_only_and_does_not_acquire_the_operation_lock() {
    let shell = Shell::project(&["feature"]);
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(shell.cwd.join(".git/wt-operation.lock"))
        .unwrap();
    // SAFETY: the fixture keeps this descriptor open until the test returns.
    assert_eq!(
        unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) },
        0
    );
    let before = (state(&shell.cwd), state(&shell.trees));
    let trace = shell.home.path().join("completion-trace.jsonl");
    let output = shell
        .command()
        .env("GIT_TRACE2_EVENT", &trace)
        .args(["__complete", "2", "wt", "enter", "fea"])
        .output()
        .unwrap();
    assert_eq!(candidates(output), ["feature"]);
    assert_eq!((state(&shell.cwd), state(&shell.trees)), before);
    for line in fs::read_to_string(trace).unwrap().lines() {
        let event: serde_json::Value = serde_json::from_str(line).unwrap();
        if event["event"] != "start" {
            continue;
        }
        let args = event["argv"].as_array().unwrap();
        match args[2].as_str().unwrap() {
            "config" => assert_eq!(args[3], "--get"),
            "worktree" => assert_eq!(args[3], "list"),
            "remote" => assert_eq!(args.len(), 3),
            "rev-parse" | "symbolic-ref" | "check-ref-format" => {}
            command => panic!("Unexpected completion Git command: {command}"),
        }
    }
}

#[test]
fn worktree_alias_and_executable_paths_with_spaces_use_the_same_completion() {
    let shell = Shell::project(&["feature"]);
    let program = shell.home.path().join("worktree alias with spaces");
    fs::create_dir(&program).unwrap();
    let alias = program.join("worktree");
    std::os::unix::fs::symlink(env!("CARGO_BIN_EXE_wt"), &alias).unwrap();
    assert_eq!(
        candidates(shell.complete_as(&alias, &["enter", "fea"])),
        ["feature"]
    );
}

#[test]
fn invalid_or_finished_positions_do_not_offer_more_task_names() {
    let shell = Shell::project(&["feature"]);
    for words in [
        vec!["enter", "feature", "fea"],
        vec!["new", "fea"],
        vec!["new", "--base", "fea"],
        vec!["enter", "--bogus", "fea"],
        vec!["clean", "--", "--ch"],
        vec!["unknown", "fea"],
        vec!["completions", "bash", "fea"],
        vec!["enter", "--json", "--j"],
    ] {
        assert!(candidates(shell.complete(&words)).is_empty(), "{words:?}");
    }
    assert_eq!(candidates(shell.complete(&["completions", "ba"])), ["bash"]);
}

#[test]
fn missing_repositories_and_literal_shell_metacharacters_are_quiet() {
    let shell = Shell::new();
    assert!(candidates(shell.complete(&["enter", "fea"])).is_empty());
    let shell = Shell::project(&["feature"]);
    for prefix in [
        "$(touch injected)",
        "fea*",
        "`touch injected`",
        "fea;touch injected",
    ] {
        assert!(candidates(shell.complete(&["enter", prefix])).is_empty());
    }
    assert!(!shell.cwd.join("injected").exists());
}

#[test]
fn unsupported_setup_and_malformed_queries_do_not_access_a_repository() {
    let shell = Shell::new();
    for args in [
        vec!["completions"],
        vec!["completions", "zsh"],
        vec!["completions", "bash", "--json"],
    ] {
        let output = shell.command().args(args).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(
            String::from_utf8(output.stderr)
                .unwrap()
                .contains("completions bash")
        );
    }
    for args in [
        vec!["__complete"],
        vec!["__complete", "bad"],
        vec!["__complete", "999", "wt", "enter"],
    ] {
        assert!(candidates(shell.command().args(args).output().unwrap()).is_empty());
    }
    let output = shell
        .command()
        .args(["__complete", "1", "wt", &"x".repeat(33 * 1024)])
        .output()
        .unwrap();
    assert!(candidates(output).is_empty());
    assert!(!shell.trees.exists());
}

#[test]
fn unmanaged_entries_do_not_hide_managed_names_beyond_the_normal_list_limit() {
    let shell = Shell::project(&["feature"]);
    for number in 0..51 {
        let path = shell.home.path().join(format!("aaa-unmanaged-{number:02}"));
        shell.git(&["worktree", "add", "--detach", path.to_str().unwrap()]);
    }
    let listed = shell.command().args(["list", "--json"]).output().unwrap();
    let listed: serde_json::Value = serde_json::from_slice(&listed.stdout).unwrap();
    assert!(listed["omitted"].as_u64().unwrap() > 0);
    assert!(
        !listed["worktrees"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["managed"] == true)
    );
    assert_eq!(candidates(shell.complete(&["enter", "fea"])), ["feature"]);
    assert!(candidates(shell.complete(&["enter", "aaa"])).is_empty());
}

#[test]
fn bash_setup_help_is_available_before_or_after_the_shell_name() {
    let shell = Shell::new();
    for args in [
        ["completions", "--help"].as_slice(),
        ["completions", "bash", "--help"].as_slice(),
    ] {
        let output = shell.command().args(args).output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(
            String::from_utf8(output.stdout)
                .unwrap()
                .contains("completions bash")
        );
    }
    assert!(!shell.trees.exists());
}

#[test]
fn new_base_contexts_offer_neither_revisions_nor_flags() {
    let shell = Shell::new();
    for words in [
        ["new", "task", "--base", "=", "main", "--l"].as_slice(),
        ["new", "--base", "=", "main", "task", "--l"].as_slice(),
        ["new", "task", "--base", "main", "--l"].as_slice(),
        ["new", "task", "--base=main", "--l"].as_slice(),
    ] {
        assert!(candidates(shell.complete(words)).is_empty(), "{words:?}");
    }
    assert!(candidates(shell.complete(&["new", "task", "--base", "=", "ma"])).is_empty());
    assert!(candidates(shell.complete(&["new", "task", "--base", "="])).is_empty());
}

#[test]
fn setup_does_not_suggest_help_flags_or_repeat_the_shell_name() {
    let shell = Shell::new();
    assert!(candidates(shell.complete(&["completions", "bash", "--h"])).is_empty());
    assert!(candidates(shell.complete(&["completions", "bash", "ba"])).is_empty());
}

#[test]
fn root_help_explains_the_opt_in_bash_setup_command() {
    let shell = Shell::new();
    let output = shell.command().arg("--help").output().unwrap();
    assert!(output.status.success());
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("wt completions bash")
    );
}

#[test]
fn bash_setup_registers_both_names_and_completes_subcommands_outside_a_repository() {
    let shell = Shell::new();
    assert_eq!(candidates(shell.complete(&["en"])), ["enter"]);
    assert!(!shell.cwd.join(".git").exists());
    assert!(!shell.home.path().join("trees").exists());
}
