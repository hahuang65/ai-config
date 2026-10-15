use crate::{process, records::Metadata, repository::Repository, text};
use std::fs;
use std::path::PathBuf;

struct OwnershipFixture {
    _temporary: tempfile::TempDir,
    directory: PathBuf,
    repo: Repository,
}

impl OwnershipFixture {
    fn new() -> Self {
        Self::with_prefix("wt-ownership-")
    }

    fn with_prefix(prefix: &str) -> Self {
        let temporary = tempfile::Builder::new().prefix(prefix).tempdir().unwrap();
        let directory = temporary.path().canonicalize().unwrap();
        let root = directory.join("project");
        fs::create_dir(&root).unwrap();
        let worktree_root = directory.join("trees");
        let repo = Repository {
            cwd: root.clone(),
            common: directory.join(text::pathbuf(&text::decode(b"parent-\xff/project/.git"))),
            branch_names: crate::git::BranchNames::new(&root),
            root,
            directory: worktree_root.join("project"),
            worktree_root,
            name: "project".into(),
            remote: None,
            base: "main".into(),
        };
        Self {
            _temporary: temporary,
            directory,
            repo,
        }
    }

    fn task_with_metadata(&self) -> PathBuf {
        let task = self.repo.directory.join("feature");
        fs::create_dir(&task).unwrap();
        process::run(
            &task,
            &["git", "-c", "init.templateDir=", "init", "-b", "main"],
            true,
            10,
        )
        .unwrap();
        let metadata = Metadata {
            version: 1,
            path: text::path(&task),
            task: "feature".into(),
            branch: "tu/feature".into(),
            base: "main".into(),
            remote: None,
            delivery: "local".into(),
        };
        fs::write(
            task.join(".git/wt.json"),
            serde_json::to_vec(&metadata).unwrap(),
        )
        .unwrap();
        task
    }
}

#[test]
fn ownership_fixtures_with_the_same_prefix_keep_their_files_separate() {
    let prefix = format!("wt-ownership-collision-{}", std::process::id());
    let first = OwnershipFixture::with_prefix(&prefix);
    let second = OwnershipFixture::with_prefix(&prefix);
    let retained = second.directory.join("retained");
    fs::write(&retained, "second fixture").unwrap();
    assert_ne!(first.directory, second.directory);
    drop(first);
    assert_eq!(fs::read_to_string(retained).unwrap(), "second fixture");
}

#[test]
fn ownership_bytes_allow_reclaiming_the_same_repository_only() {
    let mut fixture = OwnershipFixture::new();
    fixture.repo.claim_directory().unwrap();
    let owner = fixture.repo.directory.join(".repository");
    let expected = text::encode(&format!("{}\n", text::path(&fixture.repo.common)));
    assert!(std::str::from_utf8(&expected).is_err());
    assert_eq!(fs::read(&owner).unwrap(), expected);
    fixture.repo.claim_directory().unwrap();
    fixture.repo.common = fixture
        .directory
        .join(text::pathbuf(&text::decode(b"parent-\xfe/project/.git")));
    assert!(fixture.repo.claim_directory().is_err());
    assert_eq!(fs::read(owner).unwrap(), expected);
}

#[test]
fn warmed_branch_syntax_does_not_cache_the_ownership_record() {
    let fixture = OwnershipFixture::new();
    fixture.repo.claim_directory().unwrap();
    let task = fixture.task_with_metadata();
    let record = task.join(".git/wt.json");
    let original = fs::read(&record).unwrap();
    assert!(fixture.repo.metadata(&task).unwrap().is_some());
    for field in ["branch", "base"] {
        let mut changed: serde_json::Value = serde_json::from_slice(&original).unwrap();
        changed[field] = "invalid..name".into();
        fs::write(&record, serde_json::to_vec(&changed).unwrap()).unwrap();
        assert!(
            fixture.repo.metadata(&task).unwrap().is_none(),
            "stale {field}"
        );
        fs::write(&record, &original).unwrap();
        assert!(fixture.repo.metadata(&task).unwrap().is_some());
    }
}

#[test]
fn ownership_bytes_authorize_metadata_for_the_same_repository_only() {
    let mut fixture = OwnershipFixture::new();
    fixture.repo.claim_directory().unwrap();
    let task = fixture.task_with_metadata();
    let metadata = fixture.repo.metadata(&task).unwrap().unwrap();
    assert_eq!(metadata.task, "feature");
    fixture.repo.common = fixture
        .directory
        .join(text::pathbuf(&text::decode(b"parent-\xfe/project/.git")));
    assert!(fixture.repo.metadata(&task).unwrap().is_none());
}
