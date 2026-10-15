use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::OnceLock,
};

enum Entry {
    Directory(PathBuf),
    File(PathBuf, Vec<u8>, fs::Permissions),
}

// Share immutable initial-repository bytes only within this test process.
// Every fixture gets independent files, including refs, config and objects.
pub fn initialize(path: &Path) {
    static TEMPLATE: OnceLock<Vec<Entry>> = OnceLock::new();
    for entry in TEMPLATE.get_or_init(template) {
        match entry {
            Entry::Directory(relative) => fs::create_dir(path.join(relative)).unwrap(),
            Entry::File(relative, bytes, permissions) => {
                let destination = path.join(relative);
                fs::write(&destination, bytes).unwrap();
                fs::set_permissions(destination, permissions.clone()).unwrap();
            }
        }
    }
}

fn git(path: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(path)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        // Snapshot a quiescent seed, not transient background-maintenance locks.
        .args(["-c", "maintenance.auto=false", "-c", "gc.auto=0"])
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn template() -> Vec<Entry> {
    let seed = tempfile::tempdir().unwrap();
    for args in [
        vec!["init", "-b", "main", "--template="],
        vec!["config", "user.name", "Test User"],
        vec!["config", "user.email", "test@example.invalid"],
        vec!["commit", "--allow-empty", "-m", "initial"],
    ] {
        git(seed.path(), &args);
    }
    let mut entries = Vec::new();
    capture(seed.path(), Path::new(""), &mut entries);
    entries
}

fn capture(root: &Path, relative: &Path, entries: &mut Vec<Entry>) {
    for item in fs::read_dir(root.join(relative)).unwrap() {
        let item = item.unwrap();
        let child = relative.join(item.file_name());
        let kind = item.file_type().unwrap();
        if kind.is_dir() {
            entries.push(Entry::Directory(child.clone()));
            capture(root, &child, entries);
        } else {
            assert!(
                kind.is_file(),
                "repository seed must contain only regular files"
            );
            entries.push(Entry::File(
                child,
                fs::read(item.path()).unwrap_or_else(|error| {
                    panic!("cannot snapshot fixture {}: {error}", item.path().display())
                }),
                item.metadata().unwrap().permissions(),
            ));
        }
    }
}

#[test]
fn fixtures_do_not_share_mutable_config_refs_or_files() {
    let first = tempfile::tempdir().unwrap();
    initialize(first.path());
    git(first.path(), &["config", "fixture.marker", "shared-marker"]);
    git(
        first.path(),
        &["commit", "--allow-empty", "-m", "first-only"],
    );
    fs::write(first.path().join("private.txt"), "first-only").unwrap();
    let second = tempfile::tempdir().unwrap();
    initialize(second.path());
    assert!(!second.path().join("private.txt").exists());
    assert!(
        !fs::read_to_string(second.path().join(".git/config"))
            .unwrap()
            .contains("shared-marker")
    );
    assert_ne!(
        fs::read(first.path().join(".git/refs/heads/main")).unwrap(),
        fs::read(second.path().join(".git/refs/heads/main")).unwrap()
    );
}
