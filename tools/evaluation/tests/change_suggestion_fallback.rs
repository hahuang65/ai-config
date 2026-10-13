mod support;
use serde_json::{Value, json};
use std::fs;
use support::{change::*, *};

fn review_suggestion(trial: &Trial, provider: &std::path::Path, kind: &str) -> Value {
    let output = command(trial)
        .env("CHANGE_PROVIDER", provider)
        .env("CHANGE_TEST_KIND", kind)
        .args([
            "review",
            "pr",
            "https://github.com/fixture/repo/pull/7",
            "--repo",
        ])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Review changed-code opportunities", "--json"])
        .output()
        .unwrap();
    success(output.clone());
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn retains_valid_suggestions_as_summary_comments_when_provider_patch_is_incomplete() {
    let trial = fixture();
    for kind in ["refactor", "reuse"] {
        for file in [
            json!({"filename":"source.txt", "status":"modified"}),
            json!({"filename":"source.txt", "status":"modified", "patch":"@@ -1 +1 @@\n-before"}),
        ] {
            let provider = provider(&trial);
            let mut state = read_json(&provider);
            state["files"] = json!([file]);
            put(&provider, state.to_string());
            let result = review_suggestion(&trial, &provider, kind);
            let report = read_json(result["record"].as_str().unwrap());
            assert_eq!(report["findings"][0]["kind"], kind);
            assert_eq!(report["findings"][0]["line"], 1);
            assert_eq!(report["findings"][0]["inline"], false);
            let html = fs::read_to_string(result["report"].as_str().unwrap()).unwrap();
            assert!(html.contains("not verified"));
            let outcome = terminal(
                &trial,
                &provider,
                result["report"].as_str().unwrap(),
                &["post"],
            );
            assert_eq!(outcome["code"], 0);
            let saved = read_json(&provider);
            assert_eq!(saved["posts"], 1);
            assert_eq!(saved["reviews"][0]["event"], "COMMENT");
            assert_eq!(saved["reviews"][0]["comments"], json!([]));
            assert!(
                saved["reviews"][0]["body"]
                    .as_str()
                    .unwrap()
                    .contains("opportunity")
            );
            assert!(
                saved["reviews"][0]["body"]
                    .as_str()
                    .unwrap()
                    .contains("Reported location")
            );
        }
    }
}
