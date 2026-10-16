use crate::support;
use serde_json::Value;
use std::fs;
use support::{change::*, *};

#[test]
fn findings_render_four_human_readable_sections_with_escaped_content() {
    let trial = fixture();
    let output = command(&trial)
        .env("CHANGE_TEST_MODE", "explained")
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "fixture", "--json"])
        .output()
        .unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let html = fs::read_to_string(receipt["report"].as_str().unwrap()).unwrap();
    for heading in [
        "User-facing problem",
        "Why it matters",
        "Technical details",
        "Suggested fix",
    ] {
        assert!(
            html.contains(&format!("<h5>{heading}</h5>")),
            "Missing {heading}"
        );
    }
    for text in [
        "USER_WORKFLOW",
        "USER_IMPACT",
        "SOURCE_DETAIL",
        "FIX_ACTION",
    ] {
        assert!(html.contains(text));
    }
    assert!(html.contains("&lt;script&gt;not executable&lt;/script&gt;"));
    assert!(!html.contains("<script>not executable</script>"));
    let record = read_json(receipt["record"].as_str().unwrap());
    assert!(
        record["findings"][0]["body"]
            .as_str()
            .unwrap()
            .contains("USER_IMPACT")
    );
}

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
    assert!(html.contains("<title>Change review</title>"));
    assert!(!html.to_lowercase().contains("pi evaluation"));
    assert_eq!(receipt["findingCount"], 1);
    assert_eq!(receipt["publication"], "local-only");
    assert_eq!(git(&trial, &["status", "--porcelain"]), before);
    let record: Value =
        serde_json::from_slice(&fs::read(receipt["record"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(record["scope"]["head"], git(&trial, &["rev-parse", "HEAD"]));
    assert_eq!(record["findings"][0]["id"], "F1");
}

#[test]
fn presentation_uses_names_and_a_short_intent_without_dumping_internal_evidence() {
    let trial = fixture();
    git(&trial, &["branch", "trunk", "HEAD~1"]);
    git(&trial, &["branch", "topic", "HEAD"]);
    let output = command(&trial)
        .args(["review", "range", "trunk..topic", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Make saved changes visible to users. WORKLOG_TECHNICAL_SENTINEL: implementation paths, hashes, test logs and repair protocol.", "--json"])
        .output().unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let record = read_json(receipt["record"].as_str().unwrap());
    let html = fs::read_to_string(receipt["report"].as_str().unwrap()).unwrap();
    assert!(html.contains("<dd>repo</dd>"));
    assert!(html.contains("trunk → topic"));
    assert!(html.contains("Make saved changes visible to users."));
    for hidden in [
        "Base revision",
        "Snapshot SHA-256",
        "Successful file reads",
        "scope.json",
        "WORKLOG_TECHNICAL_SENTINEL",
        record["scope"]["repository"].as_str().unwrap(),
        record["scope"]["base"].as_str().unwrap(),
    ] {
        assert!(
            !html.contains(hidden),
            "Unexpected internal detail: {hidden}"
        );
    }
    assert!(
        record["intent"]
            .as_str()
            .unwrap()
            .contains("WORKLOG_TECHNICAL_SENTINEL")
    );
    assert!(
        record["files_read"]
            .as_array()
            .unwrap()
            .iter()
            .any(|path| path == "scope.json")
    );
    assert_eq!(
        record["scope"]["base"],
        git(&trial, &["rev-parse", "trunk"])
    );
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
        "body-only",
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
    let help = command(&trial).arg("--help").output().unwrap();
    success(help.clone());
    assert!(
        String::from_utf8(help.stdout)
            .unwrap()
            .contains("Usage: review-change ")
    );
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
