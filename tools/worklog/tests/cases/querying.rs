use crate::{rows, support::World};

#[test]
fn empty_queries_and_help_do_not_create_state() {
    let world = World::new();
    for command in ["list", "history", "projects"] {
        let value = world.ok(&[command]);
        assert_eq!(value["total"], 0);
        assert_eq!(value["omitted"], 0);
    }
    assert!(world.run(&["--help"]).status.success());
    assert!(world.run(&["--version"]).status.success());
    assert!(!world.root.exists());
}

#[test]
fn queries_are_bounded_with_explicit_omission_and_period_filters() {
    let world = World::new();
    for index in 0..23 {
        world.ok(&["note", &format!("Reminder {index}")]);
    }
    let page = world.ok(&["list"]);
    assert_eq!(
        (
            rows(&page).len(),
            page["total"].as_u64(),
            page["omitted"].as_u64()
        ),
        (20, Some(23), Some(3))
    );
    assert_eq!(world.ok(&["list", "--all"])["omitted"], 0);
    assert_eq!(rows(&world.ok(&["history", "--limit", "2"]))[0]["id"], 1);
    assert_eq!(world.ok(&["history", "--until", "2000-01-01"])["total"], 0);
    assert_eq!(
        world.ok(&["history", "--since", "2000-01-01", "--all"])["total"],
        23
    );
    assert_eq!(
        world.ok(&["history", "--all"]),
        world.ok(&["history", "--all"])
    );
}

#[test]
fn invalid_invocations_have_no_mutations() {
    let world = World::new();
    for args in invalid_invocations() {
        assert_eq!(world.fail(&args).status.code(), Some(2));
        assert!(!world.root.exists());
    }
}

fn invalid_invocations() -> Vec<Vec<&'static str>> {
    vec![
        vec!["note", ""],
        vec!["start"],
        vec!["complete", "99"],
        vec!["note", "x", "--all-projects"],
        vec!["note", "x", "--project", "missing"],
        vec!["complete", "1", "--hash", "abcdef0"],
        vec!["commit", "--hash", "nope", "--subject", "x"],
        vec!["history", "--since", "bad-date"],
        vec!["history", "--since", "2025-02-01", "--until", "2025-01-01"],
        vec!["list", "--limit", "0"],
        vec!["list", "--all", "--limit", "1"],
        vec!["projects", "--unassigned"],
        vec!["note", "line\nbreak"],
        vec!["note", "x", "extra"],
        vec!["list", "--unknown"],
        vec!["note", "x", "--unassigned", "--project", "x"],
        vec!["start", "Title", "--task", "1"],
        vec!["correct", "1"],
        vec!["commit"],
        vec!["note", "   "],
    ]
}

#[test]
fn oversized_summaries_and_relative_storage_roots_are_rejected_before_mutation() {
    let world = World::new();
    world.fail(&["note", &"x".repeat(2049)]);
    let output = world
        .command(&["note", "Relative"])
        .env("WL_ROOT", "relative-state")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(!world.root.exists());
    assert!(!world.repo.join("relative-state").exists());
}

#[test]
fn text_output_identifies_tasks_and_explicit_empty_results() {
    let world = World::new();
    world.ok(&["note", "Readable reminder"]);
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_wl"))
        .env("WL_ROOT", &world.root)
        .current_dir(&world.repo)
        .arg("list")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(output.stderr.is_empty());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(
        text.contains("#1 planned")
            && text.contains("Readable reminder")
            && text.contains("0 omitted")
    );
}
