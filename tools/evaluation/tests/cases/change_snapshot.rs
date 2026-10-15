use crate::support;
use serde_json::Value;
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::Path,
};
use support::{change::*, *};

fn receipt(output: std::process::Output) -> Value {
    success(output.clone());
    serde_json::from_slice(&output.stdout).unwrap()
}

fn no_source_executable(tool: &str) {
    let trial = fixture();
    let bin = trial.temporary.path().join("repo/bin");
    let marker = trial.temporary.path().join("source-executed");
    executable(
        bin.join(tool),
        &format!(
            "#!/usr/bin/env python3\nfrom pathlib import Path\nPath({:?}).write_text('bad')\nraise SystemExit(77)\n",
            marker.to_str().unwrap()
        ),
    );
    let mut command = command(&trial);
    let inherited = command
        .get_envs()
        .find(|(key, _)| *key == "PATH")
        .unwrap()
        .1
        .unwrap()
        .to_owned();
    let path = std::env::join_paths(
        std::iter::once(bin.canonicalize().unwrap()).chain(std::env::split_paths(&inherited)),
    )
    .unwrap();
    let output = command
        .env("PATH", path)
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "fixture", "--json"])
        .output()
        .unwrap();
    assert!(!marker.exists(), "reviewed {tool} was executed");
    success(output);
}

#[test]
fn generated_diff_does_not_execute_git_from_the_original_checkout() {
    no_source_executable("git");
}

#[test]
fn reviewer_does_not_execute_pi_from_the_original_checkout() {
    no_source_executable("pi");
}

#[test]
fn credential_backups_are_not_embedded_in_local_or_committed_evidence() {
    let trial = fixture();
    for path in [
        ".npmrc.local",
        ".netrc.bak",
        ".pgpass.backup",
        "auth.json.bak",
    ] {
        put(
            trial.temporary.path().join("repo").join(path),
            "SYNTHETIC_PRIVATE_MARKER\n",
        );
    }
    let local = receipt(review(&trial, &["local"]));
    git(&trial, &["add", "."]);
    git(&trial, &["commit", "-m", "fixture backups"]);
    let range = receipt(review(&trial, &["range", "HEAD~1..HEAD"]));
    for reviewed in [local, range] {
        let snapshot = Path::new(reviewed["snapshot"].as_str().unwrap());
        let patch = fs::read_to_string(snapshot.join("patch.diff")).unwrap();
        assert!(!patch.contains("SYNTHETIC_PRIVATE_MARKER"));
        assert!(!snapshot.join("after/.npmrc.local").exists());
        assert!(
            fs::read_to_string(reviewed["report"].as_str().unwrap())
                .unwrap()
                .contains("Private path excluded")
        );
    }
}

#[test]
fn unsupported_replacements_are_not_presented_as_whole_file_additions_or_deletions() {
    for replacement in ["binary", "symlink"] {
        let trial = fixture();
        let source = trial.temporary.path().join("repo/source.txt");
        if replacement == "binary" {
            put(&source, b"\0binary");
        } else {
            fs::remove_file(&source).unwrap();
            symlink("missing-external", &source).unwrap();
        }
        let local = receipt(review(&trial, &["local"]));
        git(&trial, &["add", "source.txt"]);
        git(&trial, &["commit", "-m", "unsupported replacement"]);
        let forwards = receipt(review(&trial, &["range", "HEAD~1..HEAD"]));
        let backwards = receipt(review(&trial, &["range", "HEAD..HEAD~1"]));
        for reviewed in [local, forwards, backwards] {
            let snapshot = Path::new(reviewed["snapshot"].as_str().unwrap());
            assert!(!snapshot.join("before/source.txt").exists());
            assert!(!snapshot.join("after/source.txt").exists());
            assert!(
                fs::read_to_string(snapshot.join("patch.diff"))
                    .unwrap()
                    .is_empty()
            );
        }
    }
}

#[test]
fn executable_mode_changes_are_reviewed_without_executable_snapshot_files() {
    let trial = fixture();
    let source = trial.temporary.path().join("repo/source.txt");
    fs::set_permissions(&source, fs::Permissions::from_mode(0o755)).unwrap();
    git(&trial, &["commit", "-am", "executable"]);
    let range = receipt(review(&trial, &["range", "HEAD~1..HEAD"]));
    fs::set_permissions(&source, fs::Permissions::from_mode(0o644)).unwrap();
    let local = receipt(review(&trial, &["local"]));
    for reviewed in [range, local] {
        let snapshot = Path::new(reviewed["snapshot"].as_str().unwrap());
        let patch = fs::read_to_string(snapshot.join("patch.diff")).unwrap();
        assert!(patch.contains("100755") && patch.contains("100644"));
        assert_eq!(reviewed["findingCount"], 1);
        assert_eq!(
            fs::metadata(snapshot.join("after/source.txt"))
                .unwrap()
                .permissions()
                .mode()
                & 0o111,
            0
        );
    }
}
