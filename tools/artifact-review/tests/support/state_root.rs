use super::default_root;
use std::{
    fs,
    path::{Path, PathBuf},
};

struct Fixture(PathBuf);

impl Fixture {
    fn new() -> Self {
        let root =
            std::env::temp_dir().join(format!("review-state-{:032x}", rand::random::<u128>()));
        fs::create_dir(&root).unwrap();
        Self(root.canonicalize().unwrap())
    }
    fn git(&self, directory: &Path, args: &[&str]) {
        let mut command = vec![
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "user.name=Fixture",
            "-c",
            "user.email=fixture@example.invalid",
        ];
        command.extend_from_slice(args);
        crate::state_git::run(directory, &command).unwrap();
    }
    fn repository(&self, name: &str) -> PathBuf {
        let path = self.0.join(name);
        fs::create_dir(&path).unwrap();
        self.git(&path, &["init", "-q", "--initial-branch=main"]);
        self.git(
            &path,
            &[
                "commit",
                "-q",
                "--allow-empty",
                "--no-gpg-sign",
                "-m",
                "Fixture",
            ],
        );
        path
    }
    fn task(&self, primary: &Path) -> PathBuf {
        let task = self.0.join("task checkout");
        self.git(
            primary,
            &[
                "worktree",
                "add",
                "-q",
                "-b",
                "hh/task",
                task.to_str().unwrap(),
            ],
        );
        task
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn linked_builds_share_the_primary_checkouts_default_review_state() {
    let fixture = Fixture::new();
    let primary = fixture.repository("primary checkout");
    let task = fixture.task(&primary);
    assert_eq!(
        default_root(&task).unwrap(),
        default_root(&primary).unwrap()
    );
    assert_eq!(default_root(&task).unwrap(), primary.join(".state/reviews"));
}

#[test]
fn submodule_worktrees_share_the_submodules_primary_state_not_the_parent_state() {
    let fixture = Fixture::new();
    let origin = fixture.repository("origin");
    let parent = fixture.repository("parent");
    let primary = parent.join("module checkout ");
    fixture.git(
        &parent,
        &[
            "-c",
            "protocol.file.allow=always",
            "submodule",
            "add",
            "-q",
            origin.to_str().unwrap(),
            "module checkout ",
        ],
    );
    let task = fixture.task(&primary);
    assert_eq!(default_root(&task).unwrap(), primary.join(".state/reviews"));
    assert_eq!(
        default_root(&primary).unwrap(),
        primary.join(".state/reviews")
    );
    assert_ne!(default_root(&task).unwrap(), default_root(&parent).unwrap());
}

#[test]
fn an_export_without_git_metadata_keeps_its_explicit_package_local_default() {
    let fixture = Fixture::new();
    assert_eq!(
        default_root(&fixture.0).unwrap(),
        fixture.0.join(".state/reviews")
    );
}

#[test]
fn default_root_never_executes_git_from_an_inherited_excluded_source() {
    use std::os::unix::fs::PermissionsExt;
    let fixture = Fixture::new();
    let primary = fixture.repository("package");
    let task = fixture.task(&primary);
    let reviewed = fixture.repository("reviewed source");
    let bin = reviewed.join("bin");
    fs::create_dir(&bin).unwrap();
    fs::write(
        bin.join("git"),
        "#!/bin/sh\nprintf invoked > \"$AR_STATE_MARKER\"\nexit 7\n",
    )
    .unwrap();
    fs::set_permissions(bin.join("git"), fs::Permissions::from_mode(0o755)).unwrap();
    let marker = fixture.0.join("untrusted-git-ran");
    let output = run_source_probe(&fixture, &task, &primary, &reviewed, bin);
    assert!(
        !marker.exists(),
        "Default-root discovery executed a Git executable from reviewed source"
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert_eq!(
        fs::read_to_string(fixture.0.join("root-result")).unwrap(),
        primary.join(".state/reviews").to_str().unwrap()
    );
}

fn run_source_probe(
    fixture: &Fixture,
    task: &Path,
    primary: &Path,
    reviewed: &Path,
    bin: PathBuf,
) -> std::process::Output {
    let path = std::env::join_paths(
        std::iter::once(bin).chain(std::env::split_paths(&std::env::var_os("PATH").unwrap())),
    )
    .unwrap();
    std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "review_state::tests::excluded_source_default_root_probe",
            "--nocapture",
        ])
        .current_dir(&fixture.0)
        .env("PATH", path)
        .env("AR_STATE_MARKER", fixture.0.join("untrusted-git-ran"))
        .env("AR_STATE_SOURCE", task)
        .env("AR_STATE_EXPECTED_ROOT", primary.join(".state/reviews"))
        .env("AR_STATE_RESULT", fixture.0.join("root-result"))
        .env(
            "AI_REVIEW_EXCLUDED_SOURCES",
            serde_json::to_string(&[reviewed]).unwrap(),
        )
        .output()
        .unwrap()
}

#[test]
fn excluded_source_default_root_probe() {
    let Some(source) = std::env::var_os("AR_STATE_SOURCE") else {
        return;
    };
    let expected = PathBuf::from(std::env::var_os("AR_STATE_EXPECTED_ROOT").unwrap());
    let actual = default_root(&PathBuf::from(source)).unwrap();
    assert_eq!(actual, expected);
    fs::write(
        std::env::var_os("AR_STATE_RESULT").unwrap(),
        actual.as_os_str().as_encoded_bytes(),
    )
    .unwrap();
}

#[test]
fn an_invalid_git_directory_cannot_select_the_enclosing_repository_queue() {
    let fixture = Fixture::new();
    let parent = fixture.repository("parent");
    let source = parent.join("package");
    fs::create_dir(&source).unwrap();
    fs::create_dir(source.join(".git")).unwrap();
    let result = default_root(&source);
    assert!(
        result.is_err(),
        "Invalid package metadata selected an ancestor queue: {result:?}"
    );
    assert!(result.unwrap_err().contains("AR_ROOT"));
}

#[test]
fn dangling_git_metadata_never_falls_back_to_an_export_queue() {
    let fixture = Fixture::new();
    let parent = fixture.repository("parent");
    let source = parent.join("package");
    fs::create_dir(&source).unwrap();
    std::os::unix::fs::symlink(fixture.0.join("missing-admin"), source.join(".git")).unwrap();
    let result = default_root(&source);
    assert!(
        result.is_err(),
        "Dangling Git metadata silently selected another queue: {result:?}"
    );
    assert!(result.unwrap_err().contains("AR_ROOT"));
}

#[test]
fn broken_git_identity_does_not_silently_create_another_queue() {
    let fixture = Fixture::new();
    fs::write(fixture.0.join(".git"), "gitdir: missing-admin\n").unwrap();
    assert!(default_root(&fixture.0).is_err());
}
