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
fn more_than_2000_files_can_be_reviewed_in_working_and_committed_trees() {
    let trial = fixture();
    for index in 0..2000 {
        put(
            trial
                .temporary
                .path()
                .join(format!("repo/extra/{index}.txt")),
            "tiny\n",
        );
    }
    let local = receipt(review(&trial, &["local"]));
    let snapshot = Path::new(local["snapshot"].as_str().unwrap());
    assert_eq!(
        read_json(snapshot.join("scope.json"))["after"]
            .as_array()
            .unwrap()
            .len(),
        2001
    );
    assert_eq!(
        fs::read(snapshot.join("after/extra/1999.txt")).unwrap(),
        b"tiny\n"
    );

    // Exercise the committed listing without thousands of subprocess blob reads.
    // Privacy exclusions still apply even when a repository is trusted.
    let extra = trial.temporary.path().join("repo/extra");
    for index in 0..2000 {
        fs::rename(
            extra.join(format!("{index}.txt")),
            extra.join(format!(".env-{index}")),
        )
        .unwrap();
    }
    git(&trial, &["add", "extra"]);
    git(&trial, &["commit", "-m", "many excluded files"]);
    let range = receipt(review(&trial, &["range", "HEAD~1..HEAD"]));
    let snapshot = Path::new(range["snapshot"].as_str().unwrap());
    let manifest = read_json(snapshot.join("scope.json"));
    assert_eq!(manifest["after"].as_array().unwrap().len(), 1);
    assert_eq!(manifest["excluded"].as_object().unwrap().len(), 2000);
    assert!(!snapshot.join("after/extra/.env-1999").exists());
}

#[test]
fn snapshot_text_can_exceed_12_mib_without_truncation() {
    let trial = fixture();
    let size = 13 * 1024 * 1024;
    put(
        trial.temporary.path().join("repo/large.txt"),
        vec![b'x'; size],
    );
    git(&trial, &["add", "large.txt"]);
    git(&trial, &["commit", "-m", "large text fixture"]);
    for target in [vec!["range", "HEAD..HEAD"], vec!["local"]] {
        let reviewed = receipt(review(&trial, &target));
        let snapshot = Path::new(reviewed["snapshot"].as_str().unwrap());
        for side in ["before", "after"] {
            assert_eq!(
                fs::metadata(snapshot.join(side).join("large.txt"))
                    .unwrap()
                    .len(),
                size as u64
            );
        }
    }
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
