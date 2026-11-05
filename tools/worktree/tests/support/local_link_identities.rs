use super::*;
use std::{cell::RefCell, collections::BTreeMap, process::Command};

#[path = "repository.rs"]
mod fixture;

thread_local! {
    static READS: RefCell<BTreeMap<PathBuf, usize>> = RefCell::default();
}

pub(super) fn record_identity_read(path: &Path) {
    READS.with_borrow_mut(|counts| *counts.entry(path.to_owned()).or_default() += 1);
}

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(root)
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .args(args)
        .output()
        .unwrap();
    assert!(output.status.success(), "{output:?}");
    String::from_utf8(output.stdout).unwrap().trim().into()
}

fn repository() -> (tempfile::TempDir, Repository) {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().canonicalize().unwrap().join("project");
    fs::create_dir(&root).unwrap();
    fixture::initialize(&root);
    fs::create_dir_all(root.join("src/shared")).unwrap();
    for name in ["first.rs", "second.rs"] {
        fs::write(root.join("src/shared").join(name), "TRACKED_CANARY\n").unwrap();
    }
    git(&root, &["add", "src"]);
    git(&root, &["commit", "-m", "tracked neighbors"]);
    fs::create_dir_all(root.join("local/shared")).unwrap();
    for name in ["first.tfvars", "second.tfvars"] {
        let relative = format!("local/shared/{name}");
        fs::write(root.join(&relative), "LOCAL_CANARY\n").unwrap();
        git(&root, &["config", "--local", "--add", "wt.link", &relative]);
    }
    let repository = Repository::new(&root).unwrap();
    (temporary, repository)
}

fn assert_reads_once() {
    READS.with_borrow(|counts| {
        assert!(!counts.is_empty());
        let worst = counts.values().max().copied().unwrap();
        assert_eq!(
            worst, 1,
            "Collision validation repeated metadata reads: {counts:?}"
        );
    });
}

#[test]
fn later_validation_and_installation_do_not_reuse_prior_filesystem_observations() {
    let (_temporary, repo) = repository();
    let links = Links::prepare(&repo).unwrap();
    let source = repo.root.join("local/shared/second.tfvars");
    fs::remove_file(&source).unwrap();
    symlink(repo.root.join("src/shared/first.rs"), &source).unwrap();
    assert!(links.check_start(&repo, "HEAD").is_err());
    let target = repo.root.parent().unwrap().join("task");
    fs::create_dir(&target).unwrap();
    assert!(links.install(&repo.root, &target).is_err());
    assert_eq!(fs::read_dir(target).unwrap().count(), 0);
    assert_eq!(
        fs::read_to_string(repo.root.join("src/shared/first.rs")).unwrap(),
        "TRACKED_CANARY\n"
    );
}

#[test]
fn collision_validation_reads_each_filesystem_prefix_once_per_pass() {
    let (_temporary, repo) = repository();
    READS.with_borrow_mut(BTreeMap::clear);
    let links = Links::prepare(&repo).unwrap();
    assert_reads_once();
    READS.with_borrow_mut(BTreeMap::clear);
    links.check_start(&repo, "HEAD").unwrap();
    assert_reads_once();
}
