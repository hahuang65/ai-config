use crate::support::{World, git};
use std::{fs, process::Command};

#[test]
fn seeded_notes_are_distinct_project_tasks_and_accept_subsequent_cli_writes() {
    let world = World::new();
    world.seed_notes(3);
    let listed = world.ok(&["list", "--all"]);
    assert_eq!(listed["total"], 3);
    for (index, task) in crate::rows(&listed).iter().enumerate() {
        assert_eq!(task["id"], index + 1);
        assert_eq!(task["title"], format!("Reminder {index}"));
        assert_eq!(task["state"], "planned");
        assert_eq!(task["project"]["name"], "project");
    }
    assert_eq!(world.ok(&["note", "Next note"])["entry"]["id"], 4);
    assert_eq!(world.ok(&["history", "--all"])["total"], 4);
}

#[test]
fn repository_setup_does_not_share_mutable_git_state_or_history() {
    let first = World::new();
    git(&first.repo, &["config", "fixture.marker", "first"]);
    git(
        &first.repo,
        &["symbolic-ref", "HEAD", "refs/heads/first-only"],
    );
    fs::write(first.repo.join("private.txt"), "first fixture").unwrap();
    first.ok(&["note", "First history"]);

    let second = World::new();
    let config = Command::new("git")
        .current_dir(&second.repo)
        .args(["config", "--local", "--get", "fixture.marker"])
        .output()
        .unwrap();
    assert_eq!(config.status.code(), Some(1));
    assert!(!second.repo.join("private.txt").exists());
    assert_ne!(
        fs::read(first.repo.join(".git/HEAD")).unwrap(),
        fs::read(second.repo.join(".git/HEAD")).unwrap()
    );
    assert_eq!(second.ok(&["history"])["total"], 0);
    second.ok(&["note", "Second history"]);
    assert_eq!(first.ok(&["history"])["total"], 1);
    assert_eq!(second.ok(&["history"])["total"], 1);
}
