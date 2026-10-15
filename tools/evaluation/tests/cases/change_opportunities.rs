use crate::support;
use serde_json::Value;
use std::fs;
use support::{change::*, *};

fn opportunity(trial: &Trial, kind: &str, mode: &str) -> std::process::Output {
    command(trial)
        .env("CHANGE_TEST_KIND", kind)
        .env("CHANGE_TEST_MODE", mode)
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args([
            "--intent",
            "Review defects and change-scoped opportunities",
            "--json",
        ])
        .output()
        .unwrap()
}

#[test]
fn distinguishes_change_scoped_refactoring_and_reuse_from_defects() {
    let trial = fixture();
    for (kind, label) in [
        ("refactor", "Refactoring opportunity"),
        ("reuse", "Reuse opportunity"),
    ] {
        let output = opportunity(&trial, kind, "");
        success(output.clone());
        let result: Value = serde_json::from_slice(&output.stdout).unwrap();
        let report = read_json(result["record"].as_str().unwrap());
        assert_eq!(report["findings"][0]["kind"], kind);
        let html = fs::read_to_string(result["report"].as_str().unwrap()).unwrap();
        assert!(html.contains(label));
        assert_eq!(result["publication"], "local-only");
    }
}

#[test]
fn rejects_invented_categories_and_suggestions_outside_changed_lines() {
    let trial = fixture();
    for (kind, mode) in [
        ("auto-fix", ""),
        ("reuse", "unchanged-suggestion"),
        ("refactor", "unchanged-suggestion"),
    ] {
        let output = opportunity(&trial, kind, mode);
        assert_eq!(output.status.code(), Some(1));
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn retains_suggestion_labels_in_the_preview_and_mock_comment_payload() {
    let trial = fixture();
    let provider = provider(&trial);
    let output = command(&trial)
        .env("CHANGE_PROVIDER", &provider)
        .env("CHANGE_TEST_KIND", "reuse")
        .args([
            "review",
            "pr",
            "https://github.com/fixture/repo/pull/7",
            "--repo",
        ])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Review reuse", "--json"])
        .output()
        .unwrap();
    success(output.clone());
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    let terminal = terminal(
        &trial,
        &provider,
        result["report"].as_str().unwrap(),
        &["preview", "post"],
    );
    assert_eq!(terminal["code"], 0);
    assert!(
        terminal["output"]
            .as_str()
            .unwrap()
            .contains("Reuse opportunity")
    );
    let saved = read_json(provider);
    assert_eq!(saved["posts"], 1);
    assert_eq!(saved["reviews"][0]["event"], "COMMENT");
    assert!(
        saved["reviews"][0]["comments"][0]["body"]
            .as_str()
            .unwrap()
            .contains("Reuse opportunity")
    );
}

#[test]
fn preserves_the_legacy_defect_schema() {
    let trial = fixture();
    let output = review(&trial, &["range", "HEAD~1..HEAD"]);
    success(output.clone());
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    let report = read_json(result["record"].as_str().unwrap());
    assert!(report["findings"][0].get("kind").is_none());
    assert!(
        fs::read_to_string(result["report"].as_str().unwrap())
            .unwrap()
            .contains("Defect")
    );
}
