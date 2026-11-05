#[path = "local_links_safety.rs"]
mod safety;

use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    process::{Command, Output},
};

struct Project {
    _temp: tempfile::TempDir,
    root: PathBuf,
    trees: PathBuf,
}

impl Project {
    fn new() -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap().join("project");
        fs::create_dir(&root).unwrap();
        crate::repository::initialize(&root);
        Self {
            trees: root.parent().unwrap().join("trees"),
            root,
            _temp: temp,
        }
    }

    fn git(&self, args: &[&str]) -> String {
        let output = self.command("git").args(args).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap().trim().into()
    }

    fn command(&self, executable: &str) -> Command {
        let mut command = Command::new(executable);
        command
            .current_dir(&self.root)
            .env("WT_ROOT", &self.trees)
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_NOSYSTEM", "1");
        command
    }

    fn run(&self, task: &str) -> Output {
        self.command(env!("CARGO_BIN_EXE_wt"))
            .args(["new", task, "--local", "--json"])
            .output()
            .unwrap()
    }

    fn local_file(&self, path: &str) -> PathBuf {
        let source = self.root.join(path);
        fs::create_dir_all(source.parent().unwrap()).unwrap();
        fs::write(&source, "LOCAL_FILE_CANARY\n").unwrap();
        self.git(&["config", "--local", "--add", "wt.link", path]);
        source
    }

    fn task(&self, task: &str) -> PathBuf {
        self.trees.join("project").join(task)
    }
}

#[test]
fn local_links_leave_neighboring_tracked_project_files_unchanged() {
    let project = Project::new();
    let source = project.local_file("terraform/local.tfvars");
    fs::write(
        project.root.join("terraform/main.tf"),
        "TRACKED_PROJECT_CANARY\n",
    )
    .unwrap();
    project.git(&["add", "terraform/main.tf"]);
    project.git(&["commit", "-m", "tracked project file"]);
    let output = project.run("feature");
    assert!(output.status.success(), "{output:?}");
    assert_eq!(
        fs::read_link(project.task("feature").join("terraform/local.tfvars")).unwrap(),
        source
    );
    for path in [
        project.root.join("terraform/main.tf"),
        project.task("feature").join("terraform/main.tf"),
    ] {
        assert_eq!(
            fs::read_to_string(path).unwrap(),
            "TRACKED_PROJECT_CANARY\n"
        );
    }
    assert_eq!(project.git(&["diff", "--stat"]), "");
}

#[test]
fn new_does_not_run_terraform_or_setup_commands() {
    use std::os::unix::fs::PermissionsExt;
    let project = Project::new();
    project.local_file("terraform/local.tfvars");
    project.git(&["config", "--local", "wt.setup", "terraform init"]);
    let bin = project.root.parent().unwrap().join("bin");
    fs::create_dir(&bin).unwrap();
    let terraform = bin.join("terraform");
    fs::write(&terraform, "#!/bin/sh\nprintf invoked > \"$INIT_MARKER\"\n").unwrap();
    fs::set_permissions(terraform, fs::Permissions::from_mode(0o755)).unwrap();
    let marker = project.root.parent().unwrap().join("init-ran");
    let path = std::env::join_paths(
        std::iter::once(bin).chain(std::env::split_paths(&std::env::var_os("PATH").unwrap())),
    )
    .unwrap();
    let output = project
        .command(env!("CARGO_BIN_EXE_wt"))
        .env("PATH", path)
        .env("INIT_MARKER", &marker)
        .args(["new", "feature", "--local", "--json"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(!marker.exists());
    assert!(
        !project
            .task("feature")
            .join("terraform/.terraform")
            .exists()
    );
    assert!(
        project
            .task("feature")
            .join("terraform/local.tfvars")
            .is_symlink()
    );
}

#[test]
fn creation_from_a_linked_checkout_and_cleanup_preserve_the_primary_file() {
    let project = Project::new();
    let relative = "terraform/local.tfvars";
    let source = project.local_file(relative);
    fs::create_dir_all(project.root.join(".git/info")).unwrap();
    fs::write(project.root.join(".git/info/exclude"), "*.tfvars\n").unwrap();
    let first = project.run("first");
    assert!(first.status.success(), "{first:?}");
    fs::write(
        project.task("first").join(relative),
        "EDITED_THROUGH_LINK\n",
    )
    .unwrap();
    let second = project
        .command(env!("CARGO_BIN_EXE_wt"))
        .current_dir(project.task("first"))
        .args(["new", "second", "--local", "--json"])
        .output()
        .unwrap();
    assert!(second.status.success(), "{second:?}");
    assert_eq!(
        fs::read_link(project.task("second").join(relative)).unwrap(),
        source
    );
    assert_eq!(
        fs::read_to_string(&source).unwrap(),
        "EDITED_THROUGH_LINK\n"
    );
    let cleanup = project
        .command(env!("CARGO_BIN_EXE_wt"))
        .args(["clean", "first", "--json"])
        .output()
        .unwrap();
    assert!(cleanup.status.success(), "{cleanup:?}");
    assert!(!project.task("first").exists());
    assert_eq!(
        fs::read_to_string(project.task("second").join(relative)).unwrap(),
        "EDITED_THROUGH_LINK\n"
    );
    assert_eq!(fs::read_to_string(source).unwrap(), "EDITED_THROUGH_LINK\n");
}

#[test]
fn global_and_included_settings_cannot_opt_a_repository_into_local_links() {
    let project = Project::new();
    fs::write(
        project.root.join("unselected.tfvars"),
        "LOCAL_FILE_CANARY\n",
    )
    .unwrap();
    let settings = project.root.parent().unwrap().join("other.gitconfig");
    fs::write(&settings, "[wt]\nlink = unselected.tfvars\n").unwrap();
    project.git(&[
        "config",
        "--local",
        "include.path",
        settings.to_str().unwrap(),
    ]);
    let output = project
        .command(env!("CARGO_BIN_EXE_wt"))
        .env("GIT_CONFIG_GLOBAL", &settings)
        .args(["new", "feature", "--local", "--json"])
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(!project.task("feature").join("unselected.tfvars").exists());
    assert_eq!(
        fs::read_to_string(project.root.join("unselected.tfvars")).unwrap(),
        "LOCAL_FILE_CANARY\n"
    );
}

#[test]
fn multiple_repeated_settings_are_literal_file_paths_without_shell_or_glob_expansion() {
    let project = Project::new();
    let paths = [
        "local one.tfvars",
        "nested/a[1].tfvars",
        "-options.tfvars",
        "$(touch marker).tfvars",
        "line\nbreak\r.tfvars",
    ];
    for path in paths {
        project.local_file(path);
    }
    project.git(&["config", "--local", "--add", "wt.link", paths[0]]);
    let before = project.git(&["status", "--porcelain"]);
    let output = project.run("feature");
    assert!(output.status.success(), "{output:?}");
    for path in paths {
        assert_eq!(
            fs::read_link(project.task("feature").join(path)).unwrap(),
            project.root.join(path)
        );
    }
    assert_eq!(project.git(&["status", "--porcelain"]), before);
    assert!(!project.root.join("marker").exists());
    assert!(!project.task("feature").join("marker").exists());
}

#[test]
fn a_starting_revision_collision_is_refused_before_creating_a_worktree_or_branch() {
    let project = Project::new();
    let source = project.local_file("settings.tfvars");
    project.git(&["add", "settings.tfvars"]);
    project.git(&["commit", "-m", "old tracked configuration"]);
    project.git(&["branch", "older"]);
    project.git(&["rm", "--cached", "settings.tfvars"]);
    project.git(&["commit", "-m", "keep configuration local"]);
    let output = project
        .command(env!("CARGO_BIN_EXE_wt"))
        .args(["new", "feature", "--local", "--base", "older", "--json"])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    assert!(!project.task("feature").exists());
    assert_eq!(project.git(&["branch", "--list", "tu/feature"]), "");
    assert!(output.stdout.is_empty());
    assert_eq!(fs::read_to_string(source).unwrap(), "LOCAL_FILE_CANARY\n");
}

#[test]
fn tracked_sources_are_refused_before_creating_a_worktree_or_branch() {
    let project = Project::new();
    let source = project.local_file("tracked.tfvars");
    project.git(&["add", "tracked.tfvars"]);
    project.git(&["commit", "-m", "tracked configuration"]);
    let output = project.run("feature");
    assert!(!output.status.success(), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stderr).contains("untracked"));
    assert!(output.stdout.is_empty());
    assert!(!project.task("feature").exists());
    assert_eq!(project.git(&["branch", "--list", "tu/feature"]), "");
    assert_eq!(fs::read_to_string(source).unwrap(), "LOCAL_FILE_CANARY\n");
}

#[test]
fn new_links_repository_local_files_from_the_primary_checkout() {
    let project = Project::new();
    let relative = "terraform/aws/application/local settings.tfvars";
    let source = project.local_file(relative);
    fs::create_dir_all(project.root.join(".git/info")).unwrap();
    fs::write(project.root.join(".git/info/exclude"), "*.tfvars\n").unwrap();
    let output = project.run("feature");
    assert!(output.status.success(), "{output:?}");
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let task = project.task("feature");
    assert_eq!(receipt["worktree"]["path"], task.to_str().unwrap());
    let linked = task.join(relative);
    assert!(
        linked.is_symlink(),
        "wt new must link the configured local file"
    );
    assert_eq!(fs::read_link(&linked).unwrap(), source);
    assert_eq!(fs::read_to_string(&linked).unwrap(), "LOCAL_FILE_CANARY\n");
    assert_eq!(project.git(&["status", "--porcelain"]), "");
    assert_eq!(
        project.git(&["config", "--local", "--get-all", "wt.link"]),
        relative
    );
}
