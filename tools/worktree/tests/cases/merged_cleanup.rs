//! Provider and remote evidence are synthetic; these tests never contact GitHub.
use super::Project;
use serde_json::json;
use std::{fs, os::unix::fs::PermissionsExt, path::Path};

struct Merged {
    project: Project,
    head: String,
    target: String,
}

impl Merged {
    fn squash() -> Self {
        let p = Project::new();
        p.git(
            &p.root,
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/example/project.git",
            ],
        );
        p.git(&p.root, &["config", "wt.base", "main"]);
        let record = p.git(&p.task, &["rev-parse", "--git-path", "wt.json"]);
        let mut metadata: serde_json::Value =
            serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
        metadata["remote"] = json!("origin");
        fs::write(record, serde_json::to_vec(&metadata).unwrap()).unwrap();
        fs::write(p.task.join("feature.txt"), "requested feature\n").unwrap();
        p.git(&p.task, &["add", "feature.txt"]);
        p.git(&p.task, &["commit", "-m", "feature"]);
        let head = p.git(&p.task, &["rev-parse", "HEAD"]);
        p.git(&p.root, &["merge", "--squash", "tu/feature"]);
        p.git(&p.root, &["commit", "-m", "squashed feature"]);
        let target = p.git(&p.root, &["rev-parse", "HEAD"]);
        assert_ne!(head, target);
        p.git(
            &p.root,
            &["update-ref", "refs/remotes/origin/main", &target],
        );
        install_providers(&p);
        let merged = Self {
            project: p,
            head,
            target,
        };
        merged.respond(true);
        merged.remote_tip(&merged.target);
        merged
    }

    fn respond(&self, merged: bool) {
        let p = &self.project;
        fs::write(p.root.parent().unwrap().join("pulls.json"), serde_json::to_vec(&json!([{
            "number": 123, "state": "closed",
            "merged_at": if merged { Some("2026-06-01T10:00:00Z") } else { None },
            "head": {"sha": self.head, "ref": "tu/feature", "repo": {"full_name": "example/project"}},
            "base": {"ref": "main", "repo": {"full_name": "example/project"}}
        }])).unwrap()).unwrap();
    }

    fn retained(&self) -> String {
        let p = &self.project;
        let output = p.run(&p.root, &["clean", "feature", "--json"]);
        assert!(!output.status.success(), "cleanup unexpectedly succeeded");
        assert!(p.task.is_dir());
        assert_eq!(
            p.git(&p.root, &["rev-parse", "tu/feature"]),
            p.git(&p.task, &["rev-parse", "HEAD"])
        );
        String::from_utf8(output.stderr).unwrap()
    }

    fn remote_tip(&self, tip: &str) {
        fs::write(
            self.project.root.parent().unwrap().join("remote-tip"),
            format!("{tip}\trefs/heads/main\n"),
        )
        .unwrap();
    }
}

fn install_providers(p: &Project) {
    let bin = p.root.parent().unwrap().join("bin");
    fs::create_dir(&bin).unwrap();
    executable(
        &bin.join("gh"),
        "#!/bin/sh\nexec /bin/cat \"$(dirname \"$0\")/../pulls.json\"\n",
    );
    executable(
        &bin.join("git"),
        r#"#!/bin/sh
if [ "$1" = --no-pager ]; then shift; fi
if [ "$1" = ls-remote ]; then
  root="$(dirname "$0")/.."
  printf '%s\n' "$*" >> "$root/calls"
  if [ -f "$root/remote-hook" ]; then /bin/sh "$root/remote-hook"; fi
  exec /bin/cat "$root/remote-tip"
fi
exec /usr/bin/git "$@"
"#,
    );
}

fn executable(path: &Path, source: &str) {
    fs::write(path, source).unwrap();
    fs::set_permissions(path, fs::Permissions::from_mode(0o700)).unwrap();
}

#[test]
fn merged_pr_without_synchronized_matching_trees_is_retained() {
    let merged = Merged::squash();
    let p = &merged.project;
    let initial = p.git(&p.root, &["rev-parse", "main^"]);
    p.git(
        &p.root,
        &["update-ref", "refs/remotes/origin/main", &initial],
    );
    assert!(merged.retained().contains("Synchronize"));
    p.git(
        &p.root,
        &["update-ref", "refs/remotes/origin/main", &merged.target],
    );
    merged.remote_tip(&initial);
    assert!(
        merged
            .retained()
            .contains("remote integration branch changed")
    );
    merged.remote_tip(&merged.target);
    p.git(&p.root, &["update-ref", "refs/heads/main", &initial]);
    assert!(merged.retained().contains("Synchronize"));
    p.git(
        &p.root,
        &["update-ref", "refs/remotes/origin/main", &initial],
    );
    merged.remote_tip(&initial);
    assert!(merged.retained().contains("tree differs"));
}

#[test]
fn exact_merged_pr_identity_is_required_even_when_trees_match() {
    let merged = Merged::squash();
    let response = merged.project.root.parent().unwrap().join("pulls.json");
    let original: serde_json::Value =
        serde_json::from_slice(&fs::read(&response).unwrap()).unwrap();
    for (pointer, value) in [
        ("/0/merged_at", serde_json::Value::Null),
        ("/0/head/sha", json!("0".repeat(40))),
        ("/0/head/ref", json!("tu/other")),
        ("/0/head/repo/full_name", json!("fork/project")),
        ("/0/base/ref", json!("release")),
        ("/0/base/repo/full_name", json!("example/other")),
    ] {
        let mut payload = original.clone();
        *payload.pointer_mut(pointer).unwrap() = value;
        fs::write(&response, serde_json::to_vec(&payload).unwrap()).unwrap();
        assert!(merged.retained().contains("No merged pull request"));
    }
}

#[test]
fn dirty_untracked_locked_and_in_progress_tasks_are_preserved() {
    let merged = Merged::squash();
    let p = &merged.project;
    fs::write(p.task.join("feature.txt"), "unsaved edits").unwrap();
    assert!(merged.retained().contains("modified tracked"));
    p.git(&p.task, &["add", "feature.txt"]);
    assert!(merged.retained().contains("modified tracked"));
    p.git(&p.task, &["reset", "--hard", "HEAD"]);
    fs::write(p.task.join("untracked.txt"), "keep me").unwrap();
    assert!(merged.retained().contains("untracked"));
    fs::remove_file(p.task.join("untracked.txt")).unwrap();
    p.git(&p.root, &["worktree", "lock", p.task.to_str().unwrap()]);
    assert!(merged.retained().contains("locked"));
    p.git(&p.root, &["worktree", "unlock", p.task.to_str().unwrap()]);
    let marker = p.git(&p.task, &["rev-parse", "--git-path", "MERGE_HEAD"]);
    fs::write(marker, &merged.head).unwrap();
    assert!(merged.retained().contains("operation is still in progress"));
}

#[test]
fn ignored_build_dependencies_and_reports_are_disposable() {
    let merged = Merged::squash();
    let p = &merged.project;
    let exclude = p.git(&p.task, &["rev-parse", "--git-path", "info/exclude"]);
    fs::create_dir_all(Path::new(&exclude).parent().unwrap()).unwrap();
    fs::write(exclude, ".venv/\nbuild/\nreports/\n").unwrap();
    for directory in [".venv", "build", "reports"] {
        fs::create_dir(p.task.join(directory)).unwrap();
        fs::write(p.task.join(directory).join("disposable"), "generated").unwrap();
    }
    let result = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(result["removed"], true);
    assert_eq!(result["branchRemoved"], true);
    assert!(!p.task.exists());
}

#[test]
fn github_mode_deletes_a_synchronized_squash_merged_branch() {
    let merged = Merged::squash();
    let p = &merged.project;
    let record = p.git(&p.task, &["rev-parse", "--git-path", "wt.json"]);
    let mut metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
    metadata["delivery"] = json!("github");
    fs::write(record, serde_json::to_vec(&metadata).unwrap()).unwrap();
    let result = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(result["removed"], true);
    assert_eq!(result["branchRemoved"], true);
    assert_eq!(p.git(&p.root, &["branch", "--list", "tu/feature"]), "");
}

#[test]
fn rebase_merged_task_can_be_cleaned_without_ancestry() {
    let merged = Merged::squash();
    let p = &merged.project;
    p.git(&p.root, &["reset", "--hard", "main^"]);
    p.git(
        &p.root,
        &["commit", "--allow-empty", "-m", "server-side base"],
    );
    p.git(&p.root, &["cherry-pick", &merged.head]);
    let target = p.git(&p.root, &["rev-parse", "HEAD"]);
    assert_ne!(target, merged.head);
    p.git(
        &p.root,
        &["update-ref", "refs/remotes/origin/main", &target],
    );
    merged.remote_tip(&target);
    let result = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(result["removed"], true);
    assert_eq!(result["branchRemoved"], true);
}

#[test]
fn post_removal_remote_change_reports_removed_worktree_and_retained_branch() {
    let merged = Merged::squash();
    let p = &merged.project;
    let root = p.root.parent().unwrap();
    fs::write(root.join("remote-hook"), format!(
        "if [ \"$(wc -l < '{}/calls' | tr -d ' ')\" = 3 ]; then\nprintf '%s\\trefs/heads/main\\n' '{}' > '{}/remote-tip'\nfi\n",
        root.display(), "0".repeat(40), root.display()
    )).unwrap();
    let output = p.run(&p.root, &["clean", "feature", "--json"]);
    assert!(!output.status.success());
    let result: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["removed"], true);
    assert_eq!(result["branchRemoved"], false);
    assert_eq!(result["cleanupIncomplete"], true);
    assert!(!p.task.exists());
    assert_eq!(p.git(&p.root, &["rev-parse", "tu/feature"]), merged.head);
    let reason = result["branchReason"].as_str().unwrap();
    assert!(reason.contains("remote integration branch changed"));
    assert!(!reason.contains("Worktree retained"), "{reason}");
}

#[test]
fn target_change_during_final_remote_lookup_retains_worktree_and_branch() {
    assert_target_change_retained(false);
}

#[test]
fn github_target_change_during_final_lookup_also_retains_worktree() {
    assert_target_change_retained(true);
}

fn assert_target_change_retained(github: bool) {
    let merged = Merged::squash();
    let p = &merged.project;
    if github {
        let record = p.git(&p.task, &["rev-parse", "--git-path", "wt.json"]);
        let mut metadata: serde_json::Value =
            serde_json::from_slice(&fs::read(&record).unwrap()).unwrap();
        metadata["delivery"] = json!("github");
        fs::write(record, serde_json::to_vec(&metadata).unwrap()).unwrap();
    }
    let initial = p.git(&p.root, &["rev-parse", "main^"]);
    let root = p.root.parent().unwrap();
    fs::write(root.join("remote-hook"), format!(
        "if [ \"$(wc -l < '{}/calls' | tr -d ' ')\" = 2 ]; then\n/usr/bin/git -C '{}' update-ref refs/heads/main {initial}\nfi\n",
        root.display(), p.root.display()
    )).unwrap();
    let output = p.run(&p.root, &["clean", "feature", "--json"]);
    assert!(!output.status.success());
    assert!(
        p.task.exists(),
        "a changed integration branch must stop removal"
    );
    assert_eq!(p.git(&p.root, &["rev-parse", "tu/feature"]), merged.head);
}

#[test]
fn squash_merged_local_task_removes_worktree_and_branch_after_remote_sync() {
    let merged = Merged::squash();
    let p = &merged.project;
    let check = p.ok(&p.root, &["clean", "feature", "--check", "--json"]);
    assert_eq!(check["removed"], false);
    assert!(p.task.is_dir());
    assert_eq!(p.git(&p.root, &["rev-parse", "tu/feature"]), merged.head);
    let inside = p.ok(&p.task, &["clean", "feature", "--json"]);
    assert_eq!(inside["transition"]["kind"], "return-main");
    assert_eq!(inside["removed"], false);
    let result = p.ok(&p.root, &["clean", "feature", "--json"]);
    assert_eq!(result["removed"], true);
    assert_eq!(result["branchRemoved"], true);
    assert!(result["proof"].as_str().unwrap().contains("123"));
    assert!(!p.task.exists());
    assert_eq!(p.git(&p.root, &["branch", "--list", "tu/feature"]), "");
}
