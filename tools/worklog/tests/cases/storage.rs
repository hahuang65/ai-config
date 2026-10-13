use crate::support::World;
use fs2::FileExt;
use std::{fs, process::Stdio};

#[test]
fn default_store_is_shared_under_home_not_the_build_or_invocation_directory() {
    let world = World::new();
    let root = world.home.path().join(".worklog");
    let seeded = world
        .command(&["note", "Shared history"])
        .env("WL_ROOT", &root)
        .output()
        .unwrap();
    assert!(seeded.status.success());
    let query = world
        .command(&["history", "--all-projects"])
        .env_remove("WL_ROOT")
        .env("HOME", world.home.path())
        .current_dir(world.home.path())
        .output()
        .unwrap();
    assert!(
        query.status.success(),
        "{}",
        String::from_utf8_lossy(&query.stderr)
    );
    let value: serde_json::Value = serde_json::from_slice(&query.stdout).unwrap();
    assert_eq!(value["total"], 1);
    assert_eq!(value["items"][0]["text"], "Shared history");
    let write = world
        .command(&["note", "Same store"])
        .env_remove("WL_ROOT")
        .env("HOME", world.home.path())
        .output()
        .unwrap();
    assert!(write.status.success());
    assert!(root.join("events/00000000000000000002.json").is_file());
    assert!(!world.root.exists());
}

#[test]
fn default_queries_leave_home_untouched_and_first_write_creates_a_private_store() {
    use std::os::unix::fs::PermissionsExt;
    let world = World::new();
    let root = world.home.path().join(".worklog");
    for args in [
        vec!["history", "--all-projects"],
        vec!["--help"],
        vec!["--version"],
    ] {
        let output = world
            .command(&args)
            .env_remove("WL_ROOT")
            .env("HOME", world.home.path())
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(!root.exists());
    }
    let output = world
        .command(&["note", "Private default"])
        .env_remove("WL_ROOT")
        .env("HOME", world.home.path())
        .output()
        .unwrap();
    assert!(output.status.success());
    assert_eq!(
        fs::metadata(&root).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert!(root.join("events/00000000000000000001.json").is_file());
}

#[test]
fn default_storage_requires_absolute_home_but_an_explicit_root_does_not() {
    let world = World::new();
    for home in [None, Some(""), Some("relative")] {
        let mut command = world.command(&["note", "Do not misplace history"]);
        command.env_remove("WL_ROOT").env_remove("HOME");
        if let Some(home) = home {
            command.env("HOME", home);
        }
        let output = command.output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains("HOME"));
    }
    assert!(!world.root.exists());
    let output = world
        .command(&["note", "Explicit store"])
        .env_remove("HOME")
        .output()
        .unwrap();
    assert!(output.status.success());
    assert!(!world.home.path().join(".worklog").exists());
}

#[test]
fn concurrent_writers_preserve_every_event_and_validate_transitions_under_lock() {
    let world = World::new();
    world.ok(&["note", "Seed"]);
    let mut children = (0..12)
        .map(|i| {
            world
                .command(&["note", &format!("Concurrent {i}")])
                .stdout(Stdio::null())
                .spawn()
                .unwrap()
        })
        .collect::<Vec<_>>();
    for child in &mut children {
        assert!(child.wait().unwrap().success());
    }
    assert_eq!(world.ok(&["history", "--all"])["total"], 13);
    let mut children = (0..2)
        .map(|_| {
            world
                .command(&["start", "--task", "1"])
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .spawn()
                .unwrap()
        })
        .collect::<Vec<_>>();
    let successes = children
        .iter_mut()
        .filter_map(|child| child.wait().unwrap().success().then_some(()))
        .count();
    assert_eq!(successes, 1);
    assert_eq!(world.ok(&["history", "--all"])["total"], 14);
}

#[test]
fn interrupted_pending_writes_are_ignored_and_recovered_without_history_loss() {
    let world = World::new();
    world.ok(&["note", "Durable"]);
    fs::write(world.root.join(".pending"), b"{partial").unwrap();
    assert_eq!(world.ok(&["history"])["total"], 1);
    world.ok(&["note", "After recovery"]);
    assert!(!world.root.join(".pending").exists());
    assert_eq!(world.ok(&["history"])["total"], 2);
}

#[test]
fn failed_storage_and_corrupt_entries_fail_closed_without_dumping_content() {
    let world = World::new();
    fs::write(&world.root, "not a directory").unwrap();
    assert_eq!(world.fail(&["note", "Fail safely"]).status.code(), Some(1));
    fs::remove_file(&world.root).unwrap();
    world.ok(&["note", "Durable"]);
    let entry = fs::read_dir(world.root.join("events"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::write(entry, "synthetic-private-content").unwrap();
    let output = world.fail(&["note", "Do not overwrite"]);
    assert!(!String::from_utf8_lossy(&output.stderr).contains("synthetic-private-content"));
    assert_eq!(fs::read_dir(world.root.join("events")).unwrap().count(), 1);
}

#[test]
fn lock_wait_is_bounded_and_a_released_lock_allows_recovery() {
    let world = World::new();
    world.ok(&["note", "Before lock"]);
    let lock = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .open(world.root.join(".lock"))
        .unwrap();
    lock.lock_exclusive().unwrap();
    let started = std::time::Instant::now();
    assert_eq!(world.fail(&["note", "Blocked"]).status.code(), Some(1));
    assert!(started.elapsed() < std::time::Duration::from_secs(10));
    FileExt::unlock(&lock).unwrap();
    world.ok(&["note", "Recovered"]);
    assert_eq!(world.ok(&["history"])["total"], 2);
}

#[test]
fn a_write_failure_preserves_committed_entries_and_can_be_retried() {
    let world = World::new();
    world.ok(&["note", "Before failure"]);
    fs::create_dir(world.root.join(".pending")).unwrap();
    world.fail(&["note", "Failed write"]);
    assert_eq!(world.ok(&["history"])["total"], 1);
    fs::remove_dir(world.root.join(".pending")).unwrap();
    world.ok(&["note", "After failure"]);
    assert_eq!(world.ok(&["history"])["total"], 2);
}

#[test]
fn a_crash_after_publication_does_not_republish_the_pending_entry() {
    let world = World::new();
    world.ok(&["note", "Published"]);
    let event = fs::read_dir(world.root.join("events"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    fs::hard_link(event, world.root.join(".pending")).unwrap();
    world.ok(&["note", "Next"]);
    assert_eq!(world.ok(&["history"])["total"], 2);
}

#[cfg(unix)]
#[test]
fn state_symlinks_are_rejected_and_records_are_private() {
    use std::os::unix::fs::{PermissionsExt, symlink};
    let world = World::new();
    symlink(world.home.path(), &world.root).unwrap();
    world.fail(&["note", "Unsafe"]);
    fs::remove_file(&world.root).unwrap();
    world.ok(&["note", "Private"]);
    let event = fs::read_dir(world.root.join("events"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    assert_eq!(
        fs::metadata(event).unwrap().permissions().mode() & 0o777,
        0o600
    );
}
