use crate::{
    rows,
    support::{World, git},
};
use std::fs;

#[test]
fn named_projects_and_suggestions_do_not_cross_project_boundaries() {
    let world = World::new();
    world.ok(&["note", "First"]);
    let other = world.home.path().join("other");
    fs::create_dir(&other).unwrap();
    git(&other, &["init", "-q"]);
    world.ok(&["note", "Other", "--project-path", other.to_str().unwrap()]);
    world.ok(&["note", "Unassigned", "--unassigned"]);
    world.ok(&["note", "Second", "--project", "project"]);
    world.ok(&["complete", "1"]);
    let suggestions = world.ok(&["list", "--state", "planned"]);
    assert_eq!(rows(&suggestions).len(), 1);
    assert_eq!(rows(&suggestions)[0]["title"], "Second");
    assert_eq!(world.ok(&["list", "--all-projects"])["total"], 3);
    assert_eq!(world.ok(&["list", "--unassigned"])["total"], 1);
    world.fail(&["start", "--task", "2"]);
    world.fail(&["correct", "2", "--text", "Wrong project"]);
}

#[test]
fn worktrees_share_identity_with_and_without_an_origin() {
    let world = World::new();
    git(
        &world.repo,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-qm",
            "Fixture",
        ],
    );
    let linked = world.home.path().join("linked");
    git(
        &world.repo,
        &[
            "worktree",
            "add",
            "-qb",
            "fixture",
            linked.to_str().unwrap(),
        ],
    );
    world.ok(&["note", "Shared local"]);
    assert_eq!(
        world.ok(&["list", "--project-path", linked.to_str().unwrap()])["total"],
        1
    );
    git(
        &world.repo,
        &[
            "remote",
            "add",
            "origin",
            "git@example.invalid:team/repo.git",
        ],
    );
    world.ok(&["note", "Shared origin"]);
    assert_eq!(
        world.ok(&["list", "--project-path", linked.to_str().unwrap()])["total"],
        1
    );
}

#[test]
fn relative_origin_keeps_one_project_identity_across_linked_worktrees() {
    let world = World::new();
    git(
        &world.repo,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-qm",
            "Fixture",
        ],
    );
    let linked = world.home.path().join(".worktrees/task");
    fs::create_dir_all(linked.parent().unwrap()).unwrap();
    git(
        &world.repo,
        &[
            "worktree",
            "add",
            "-qb",
            "fixture",
            linked.to_str().unwrap(),
        ],
    );
    let origin = world.home.path().join("upstream.git");
    let wrong_origin = world.home.path().join(".worktrees/upstream.git");
    fs::create_dir(&origin).unwrap();
    fs::create_dir(&wrong_origin).unwrap();
    git(&world.repo, &["remote", "add", "origin", "../upstream.git"]);

    let main = world.ok(&["note", "Main work"]);
    let from_task = world.ok(&[
        "note",
        "Task work",
        "--project-path",
        linked.to_str().unwrap(),
    ]);
    assert_eq!(
        main["entry"]["project"]["id"],
        from_task["entry"]["project"]["id"]
    );
    assert_eq!(
        world.ok(&["list", "--project-path", linked.to_str().unwrap()])["total"],
        2
    );
    assert_eq!(world.ok(&["projects"])["total"], 1);
}

#[test]
fn relative_origin_uses_the_checkout_not_a_separate_git_directory() {
    let world = World::new();
    let checkout = world.home.path().join("work/project");
    let git_dir = world.home.path().join("admin/project.git");
    let origin = world.home.path().join("work/upstream.git");
    let wrong_origin = world.home.path().join("admin/upstream.git");
    for directory in [&checkout, &origin, &wrong_origin] {
        fs::create_dir_all(directory).unwrap();
    }
    git(
        &checkout,
        &[
            "init",
            "-q",
            "--separate-git-dir",
            git_dir.to_str().unwrap(),
        ],
    );
    git(&checkout, &["remote", "add", "origin", "../upstream.git"]);

    let result = world.ok(&[
        "note",
        "Checkout identity",
        "--project-path",
        checkout.to_str().unwrap(),
    ]);
    assert_eq!(
        result["entry"]["project"]["id"],
        format!("file:{}", origin.canonicalize().unwrap().display())
    );
}

#[test]
fn relative_origin_uses_an_absorbed_submodule_checkout() {
    let world = World::new();
    let source = world.home.path().join("source");
    let parent = world.home.path().join("parent");
    for directory in [&source, &parent] {
        fs::create_dir(directory).unwrap();
        git(directory, &["init", "-q"]);
    }
    git(
        &source,
        &[
            "-c",
            "user.name=Test",
            "-c",
            "user.email=test@example.invalid",
            "commit",
            "--allow-empty",
            "-qm",
            "Fixture",
        ],
    );
    let submodule = parent.join("modules/widget");
    git(
        &parent,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            source.to_str().unwrap(),
            "modules/widget",
        ],
    );
    let origin = parent.join("modules/upstream.git");
    let wrong_origin = parent.join(".git/modules/modules/upstream.git");
    for directory in [&origin, &wrong_origin] {
        fs::create_dir_all(directory).unwrap();
    }
    git(
        &submodule,
        &["remote", "set-url", "origin", "../upstream.git"],
    );

    let result = world.ok(&[
        "note",
        "Submodule identity",
        "--project-path",
        submodule.to_str().unwrap(),
    ]);
    assert_eq!(
        result["entry"]["project"]["id"],
        format!("file:{}", origin.canonicalize().unwrap().display())
    );
    let linked = world.home.path().join("linked-widget");
    git(
        &submodule,
        &[
            "worktree",
            "add",
            "-qb",
            "fixture",
            linked.to_str().unwrap(),
        ],
    );
    let from_task = world.ok(&[
        "note",
        "Linked submodule",
        "--project-path",
        linked.to_str().unwrap(),
    ]);
    assert_eq!(
        result["entry"]["project"]["id"],
        from_task["entry"]["project"]["id"]
    );
}

#[test]
fn canonical_origins_remove_credentials_and_ambiguous_names_fail() {
    let world = World::new();
    git(
        &world.repo,
        &[
            "remote",
            "add",
            "origin",
            "https://user:synthetic-secret@example.invalid/team/repo.git?token=synthetic-query#fragment",
        ],
    );
    world.ok(&["note", "One"]);
    git(
        &world.repo,
        &[
            "remote",
            "set-url",
            "origin",
            "ssh://git@example.invalid/team/repo.git",
        ],
    );
    assert_eq!(world.ok(&["list"])["total"], 1);
    git(
        &world.repo,
        &[
            "remote",
            "set-url",
            "origin",
            "https://example.invalid/other/repo.git",
        ],
    );
    world.ok(&["note", "Two"]);
    world.fail(&["note", "Ambiguous", "--project", "repo"]);
    let projects = world.ok(&["projects"]);
    assert_eq!(projects["total"], 2);
    let disk = fs::read_dir(world.root.join("events"))
        .unwrap()
        .map(|entry| fs::read_to_string(entry.unwrap().path()).unwrap())
        .collect::<String>();
    assert!(
        !disk.contains("synthetic-secret")
            && !disk.contains("synthetic-query")
            && !disk.contains("user:")
    );
    let id = rows(&projects)[0]["id"].as_str().unwrap();
    assert_eq!(world.ok(&["list", "--project", id])["total"], 1);
}

#[test]
fn repeated_git_suffixes_keep_project_ids_lists_and_transitions_separate() {
    let world = World::new();
    git(
        &world.repo,
        &[
            "remote",
            "add",
            "origin",
            "https://example.invalid/team/app.git",
        ],
    );
    let first = world.ok(&["note", "App work"]);
    git(
        &world.repo,
        &[
            "remote",
            "set-url",
            "origin",
            "git@example.invalid:team/app.git.git",
        ],
    );
    let second = world.ok(&["note", "App.git work"]);
    let first_id = "origin:example.invalid/team/app";
    let second_id = "origin:example.invalid/team/app.git";
    assert_eq!(first["entry"]["project"]["id"], first_id);
    assert_eq!(second["entry"]["project"]["id"], second_id);
    assert_eq!(second["entry"]["project"]["name"], "app.git");
    assert_eq!(world.ok(&["projects"])["total"], 2);
    let current = world.ok(&["list"]);
    assert_eq!(current["total"], 1);
    assert_eq!(rows(&current)[0]["id"], 2);
    let original = world.ok(&["list", "--project", first_id]);
    assert_eq!(original["total"], 1);
    assert_eq!(rows(&original)[0]["id"], 1);
    world.fail(&["start", "--task", "1"]);
    world.fail(&["complete", "2", "--project", first_id]);
    world.ok(&["start", "--task", "1", "--project", first_id]);
    world.ok(&["complete", "2", "--project", second_id]);
    assert_eq!(world.ok(&["history", "--all-projects"])["total"], 4);
}

#[test]
fn non_git_directories_require_an_explicit_project_or_unassigned_scope() {
    let world = World::new();
    let output = world
        .command(&["note", "No project"])
        .current_dir(world.home.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(!world.root.exists());
    let output = world
        .command(&["note", "Explicit", "--unassigned"])
        .current_dir(world.home.path())
        .output()
        .unwrap();
    assert!(output.status.success());
}

#[test]
fn invalid_origins_fail_without_disclosing_the_origin() {
    let world = World::new();
    git(
        &world.repo,
        &[
            "remote",
            "add",
            "origin",
            "invalid://synthetic-private-origin@example.invalid/repo",
        ],
    );
    let output = world.fail(&["note", "Rejected"]);
    assert!(!String::from_utf8_lossy(&output.stderr).contains("synthetic-private-origin"));
    assert!(!world.root.exists());
}

#[test]
fn unassigned_work_requires_explicit_scope_for_every_transition() {
    let world = World::new();
    world.ok(&["note", "Unassigned", "--unassigned"]);
    world.fail(&["start", "--task", "1"]);
    world.ok(&["start", "--task", "1", "--unassigned"]);
    world.ok(&["complete", "1", "--unassigned"]);
    assert_eq!(world.ok(&["history", "--unassigned"])["total"], 3);
    world.fail(&["progress", "No project", "--unassigned"]);
}
