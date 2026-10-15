use crate::support;
use serde_json::Value;
use std::fs;
use support::{change::*, *};

#[test]
fn a_range_produces_private_frozen_evidence_and_escaped_html_without_touching_source() {
    let trial = fixture();
    let before = git(&trial, &["status", "--porcelain"]);
    let output = review(&trial, &["range", "HEAD~1..HEAD"]);
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let html = fs::read_to_string(receipt["report"].as_str().unwrap()).unwrap();
    assert!(html.contains("&lt;script&gt;bad&lt;/script&gt;"));
    assert!(!html.contains("<script>bad</script>"));
    assert!(html.contains("Tests were not run"));
    assert_eq!(receipt["findingCount"], 1);
    assert_eq!(receipt["publication"], "local-only");
    assert_eq!(git(&trial, &["status", "--porcelain"]), before);
    let record: Value =
        serde_json::from_slice(&fs::read(receipt["record"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(record["scope"]["head"], git(&trial, &["rev-parse", "HEAD"]));
    assert_eq!(record["findings"][0]["id"], "F1");
}

#[test]
fn local_review_includes_staged_unstaged_and_new_files_without_using_git_filters() {
    let trial = fixture();
    put(trial.temporary.path().join("repo/new.txt"), "new file\n");
    put(trial.temporary.path().join("repo/source.txt"), "staged\n");
    git(&trial, &["add", "source.txt"]);
    put(trial.temporary.path().join("repo/source.txt"), "unstaged\n");
    let before = git(&trial, &["status", "--porcelain"]);
    let output = review(&trial, &["local"]);
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let snapshot = std::path::Path::new(receipt["snapshot"].as_str().unwrap());
    assert_eq!(
        fs::read_to_string(snapshot.join("after/source.txt")).unwrap(),
        "unstaged\n"
    );
    assert_eq!(
        fs::read_to_string(snapshot.join("after/new.txt")).unwrap(),
        "new file\n"
    );
    assert_eq!(git(&trial, &["status", "--porcelain"]), before);
}

#[test]
fn invalid_model_output_cannot_create_a_publishable_report() {
    let trial = fixture();
    for mode in [
        "destination",
        "control",
        "malformed",
        "unsafe-path",
        "no-evidence",
    ] {
        let output = command(&trial)
            .env("CHANGE_TEST_MODE", mode)
            .args(["review", "range", "HEAD~1..HEAD", "--repo"])
            .arg(trial.temporary.path().join("repo"))
            .args(["--intent", "fixture", "--json"])
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "mode {mode}");
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn help_and_invalid_invocations_have_no_state_or_provider_side_effects() {
    let trial = Trial::new();
    success(command(&trial).arg("--help").output().unwrap());
    for args in [
        vec!["review"],
        vec!["review", "range", "a...b"],
        vec!["review", "local", "--approve"],
        vec!["post", "arbitrary.html", "--yes"],
        vec![
            "review", "local", "--intent", "fixture", "--engine", "unknown",
        ],
        vec![
            "review",
            "local",
            "--intent",
            "fixture",
            "--engine",
            "claude",
            "--provider",
            "fixture",
        ],
    ] {
        assert_eq!(
            command(&trial).args(args).output().unwrap().status.code(),
            Some(2)
        );
    }
    assert!(!trial.home.join(".local/state/ai-config").exists());
    assert!(!trial.log.exists());
}

#[test]
fn pull_request_scope_and_inline_locations_come_from_the_provider_not_the_model() {
    let trial = fixture();
    let provider = provider(&trial);
    let output = command(&trial)
        .env("CHANGE_PROVIDER", &provider)
        .args([
            "review",
            "pr",
            "https://github.com/fixture/repo/pull/7",
            "--repo",
        ])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "fixture", "--json"])
        .output()
        .unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let record: Value =
        serde_json::from_slice(&fs::read(receipt["record"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(record["scope"]["pull_request"]["number"], 7);
    assert_eq!(record["findings"][0]["inline"], true);
    assert_eq!(receipt["publication"], "confirmation-required");
    let provider: Value = serde_json::from_slice(&fs::read(provider).unwrap()).unwrap();
    assert_eq!(provider["posts"], 0);
}
