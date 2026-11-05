use super::Project;
use std::{fs, os::unix::fs::symlink};

#[test]
fn case_insensitive_tracked_source_aliases_are_rejected_even_when_the_base_omits_them() {
    let project = Project::new();
    let base = project.git(&["rev-parse", "HEAD"]);
    let source = project.root.join("LOCAL.tfvars");
    fs::write(&source, "TRACKED_CANARY\n").unwrap();
    if !project.root.join("local.tfvars").exists() {
        eprintln!("Case-insensitive filesystem regression is not applicable here");
        return;
    }
    project.git(&["config", "core.ignoreCase", "false"]);
    project.git(&["add", "LOCAL.tfvars"]);
    project.git(&["commit", "-m", "tracked configuration"]);
    project.git(&["config", "--local", "--add", "wt.link", "local.tfvars"]);
    let output = project
        .command(env!("CARGO_BIN_EXE_wt"))
        .args(["new", "feature", "--local", "--base", &base, "--json"])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty());
    assert!(!project.task("feature").exists());
    assert_eq!(project.git(&["branch", "--list", "tu/feature"]), "");
    assert_eq!(fs::read_to_string(source).unwrap(), "TRACKED_CANARY\n");
}

#[test]
fn case_insensitive_starting_tree_aliases_are_rejected_before_task_creation() {
    let project = Project::new();
    fs::write(project.root.join("LOCAL.tfvars"), "OLD_BASE_CANARY\n").unwrap();
    if !project.root.join("local.tfvars").exists() {
        eprintln!("Case-insensitive filesystem regression is not applicable here");
        return;
    }
    project.git(&["config", "core.ignoreCase", "false"]);
    project.git(&["add", "LOCAL.tfvars"]);
    project.git(&["commit", "-m", "tracked configuration"]);
    project.git(&["branch", "older"]);
    project.git(&["rm", "--cached", "LOCAL.tfvars"]);
    project.git(&["commit", "-m", "keep configuration local"]);
    let source = project.local_file("local.tfvars");
    let output = project
        .command(env!("CARGO_BIN_EXE_wt"))
        .args(["new", "feature", "--local", "--base", "older", "--json"])
        .output()
        .unwrap();
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty());
    assert!(!project.task("feature").exists());
    assert_eq!(project.git(&["branch", "--list", "tu/feature"]), "");
    assert_eq!(fs::read_to_string(source).unwrap(), "LOCAL_FILE_CANARY\n");
}

#[test]
fn starting_revisions_cannot_replace_a_local_link_parent_or_leaf_with_tracked_content() {
    for kind in ["parent-file", "parent-symlink", "leaf-directory"] {
        let project = Project::new();
        match kind {
            "parent-file" => fs::write(project.root.join("settings"), "TRACKED_CANARY\n").unwrap(),
            "parent-symlink" => symlink("../outside", project.root.join("settings")).unwrap(),
            "leaf-directory" => {
                fs::create_dir_all(project.root.join("settings/local.tfvars")).unwrap();
                fs::write(
                    project.root.join("settings/local.tfvars/tracked"),
                    "TRACKED_CANARY\n",
                )
                .unwrap();
            }
            _ => unreachable!(),
        }
        project.git(&["add", "settings"]);
        project.git(&["commit", "-m", "tracked collision"]);
        project.git(&["branch", "older"]);
        project.git(&["rm", "-r", "settings"]);
        project.git(&["commit", "-m", "remove tracked collision"]);
        let source = project.local_file("settings/local.tfvars");
        let output = project
            .command(env!("CARGO_BIN_EXE_wt"))
            .args(["new", "feature", "--local", "--base", "older", "--json"])
            .output()
            .unwrap();
        assert!(!output.status.success(), "{kind}: {output:?}");
        assert!(!project.task("feature").exists());
        assert_eq!(project.git(&["branch", "--list", "tu/feature"]), "");
        assert_eq!(fs::read_to_string(source).unwrap(), "LOCAL_FILE_CANARY\n");
    }
}

#[test]
fn late_collisions_keep_a_managed_task_without_overwriting_or_linking_other_files() {
    use std::os::unix::fs::PermissionsExt;
    let project = Project::new();
    project.local_file("a.tfvars");
    project.local_file("z.tfvars");
    let hook = project.root.join(".git/hooks/post-checkout");
    fs::create_dir_all(hook.parent().unwrap()).unwrap();
    fs::write(
        &hook,
        "#!/bin/sh\nprintf 'DESTINATION_CANARY\\n' > z.tfvars\n",
    )
    .unwrap();
    fs::set_permissions(&hook, fs::Permissions::from_mode(0o755)).unwrap();
    let output = project.run("feature");
    assert!(!output.status.success(), "{output:?}");
    assert!(output.stdout.is_empty());
    assert!(String::from_utf8_lossy(&output.stderr).contains("managed worktree and branch remain"));
    let task = project.task("feature");
    assert!(task.exists());
    assert!(!task.join("a.tfvars").exists());
    assert_eq!(
        fs::read_to_string(task.join("z.tfvars")).unwrap(),
        "DESTINATION_CANARY\n"
    );
    assert_eq!(
        fs::read_to_string(project.root.join("z.tfvars")).unwrap(),
        "LOCAL_FILE_CANARY\n"
    );
    assert_eq!(
        project.git(&[
            "branch",
            "--list",
            "--format=%(refname:short)",
            "tu/feature"
        ]),
        "tu/feature"
    );
    let inventory = project
        .command(env!("CARGO_BIN_EXE_wt"))
        .args(["list", "--json"])
        .output()
        .unwrap();
    assert!(inventory.status.success(), "{inventory:?}");
    let inventory: serde_json::Value = serde_json::from_slice(&inventory.stdout).unwrap();
    assert_eq!(inventory["worktrees"][1]["managed"], true);
}

#[test]
fn unsafe_paths_and_terraform_runtime_state_are_refused_before_creation() {
    for path in [
        "",
        ".",
        "../outside.tfvars",
        "nested/../../outside.tfvars",
        "/tmp/outside.tfvars",
        ".git/config",
        ".GIT/config",
        "nested/.git/config",
        ".terraform/environment",
        "terraform/aws/.terraform/environment",
        "terraform/.TERRAFORM/environment",
    ] {
        let project = Project::new();
        let source = project.local_file("safe.tfvars");
        project.git(&["config", "--local", "--add", "wt.link", path]);
        let output = project.run("feature");
        assert!(!output.status.success(), "{path:?}: {output:?}");
        assert!(output.stdout.is_empty());
        assert!(!project.task("feature").exists());
        assert_eq!(project.git(&["branch", "--list", "tu/feature"]), "");
        assert_eq!(fs::read_to_string(source).unwrap(), "LOCAL_FILE_CANARY\n");
    }
}

#[test]
fn sources_must_be_existing_regular_files_without_symlinked_parents() {
    for kind in ["missing", "directory", "file-link", "parent-link", "socket"] {
        let project = Project::new();
        let outside = project.root.parent().unwrap().join("outside");
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("local.tfvars"), "OUTSIDE_CANARY\n").unwrap();
        let relative = match kind {
            "missing" => "missing.tfvars",
            "directory" => {
                fs::create_dir(project.root.join("directory")).unwrap();
                "directory"
            }
            "file-link" => {
                symlink(
                    outside.join("local.tfvars"),
                    project.root.join("local.tfvars"),
                )
                .unwrap();
                "local.tfvars"
            }
            "parent-link" => {
                symlink(&outside, project.root.join("linked")).unwrap();
                "linked/local.tfvars"
            }
            "socket" => {
                let _socket =
                    std::os::unix::net::UnixListener::bind(project.root.join("socket")).unwrap();
                "socket"
            }
            _ => unreachable!(),
        };
        project.git(&["config", "--local", "--add", "wt.link", relative]);
        let output = project.run("feature");
        assert!(!output.status.success(), "{kind}: {output:?}");
        assert!(!project.task("feature").exists());
        assert!(output.stdout.is_empty());
        assert!(!String::from_utf8_lossy(&output.stderr).contains("OUTSIDE_CANARY"));
        assert_eq!(
            fs::read_to_string(outside.join("local.tfvars")).unwrap(),
            "OUTSIDE_CANARY\n"
        );
    }
}
