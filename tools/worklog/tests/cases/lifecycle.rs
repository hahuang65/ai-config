use crate::{rows, support::World};

#[test]
fn lifecycle_progress_and_finishing_commit_remain_distinct() {
    let world = World::new();
    world.ok(&["note", "Build report"]);
    world.ok(&["progress", "Design agreed", "--task", "1"]);
    assert_eq!(rows(&world.ok(&["list"]))[0]["state"], "planned");
    world.ok(&["start", "--task", "1"]);
    world.ok(&[
        "commit",
        "--task",
        "1",
        "--hash",
        "abcdef0",
        "--subject",
        "Add report",
    ]);
    assert_eq!(rows(&world.ok(&["list"]))[0]["state"], "active");
    world.ok(&[
        "complete",
        "1",
        "--hash",
        "1234567",
        "--subject",
        "Finish report",
    ]);
    assert_eq!(world.ok(&["history"])["total"], 5);
    assert_eq!(world.ok(&["list"])["total"], 0);
    let completed = world.ok(&["list", "--state", "completed"]);
    assert_eq!(rows(&completed)[0]["state"], "completed");
    world.fail(&["start", "--task", "1"]);
    world.fail(&["complete", "1"]);
    world.fail(&["progress", "Too late", "--task", "1"]);
    assert_eq!(world.ok(&["history"])["total"], 5);
}

#[test]
fn direct_start_abandon_and_project_progress_need_no_registration() {
    let world = World::new();
    world.ok(&["progress", "Explored a design"]);
    assert_eq!(world.ok(&["list"])["total"], 0);
    world.ok(&["start", "Try design"]);
    world.ok(&["abandon", "2", "--summary", "Not needed"]);
    assert_eq!(
        rows(&world.ok(&["list", "--state", "abandoned"]))[0]["id"],
        2
    );
    world.fail(&["complete", "2"]);
}

#[test]
fn corrections_change_task_titles_without_replacing_original_history() {
    let world = World::new();
    world.ok(&["note", "Old title"]);
    world.ok(&["correct", "1", "--text", "New title"]);
    world.ok(&["correct", "1", "--text", "Final title"]);
    assert_eq!(rows(&world.ok(&["list"]))[0]["title"], "Final title");
    let history = world.ok(&["history", "--all"]);
    assert_eq!(rows(&history)[0]["text"], "Old title");
    assert_eq!(rows(&history)[0]["effective_text"], "Final title");
    assert_eq!(history["total"], 3);
    world.fail(&["correct", "2", "--text", "A correction of a correction"]);
}

#[test]
fn commit_corrections_retain_the_original_hash_and_subject() {
    let world = World::new();
    world.ok(&["note", "Work"]);
    world.ok(&[
        "complete",
        "1",
        "--hash",
        "abcdef0",
        "--subject",
        "Original subject",
    ]);
    world.ok(&[
        "correct",
        "2",
        "--hash",
        "1234567",
        "--subject",
        "Actual subject",
    ]);
    let history = world.ok(&["history", "--task", "1"]);
    assert_eq!(rows(&history)[1]["commit"]["hash"], "abcdef0");
    assert_eq!(rows(&history)[1]["effective_commit"]["hash"], "1234567");
    assert_eq!(
        rows(&history)[1]["effective_commit"]["subject"],
        "Actual subject"
    );
    world.fail(&[
        "correct",
        "1",
        "--hash",
        "1234567",
        "--subject",
        "Not a commit",
    ]);
    assert_eq!(world.ok(&["history"])["total"], 3);
}

#[test]
fn project_commits_do_not_create_tasks_and_active_tasks_cannot_restart() {
    let world = World::new();
    world.ok(&[
        "commit",
        "--hash",
        "ABCDEF0",
        "--subject",
        "Project checkpoint",
    ]);
    assert_eq!(world.ok(&["list"])["total"], 0);
    assert_eq!(
        rows(&world.ok(&["history"]))[0]["commit"]["hash"],
        "abcdef0"
    );
    world.ok(&["start", "Task"]);
    world.fail(&["start", "--task", "2"]);
    assert_eq!(world.ok(&["history"])["total"], 2);
}
