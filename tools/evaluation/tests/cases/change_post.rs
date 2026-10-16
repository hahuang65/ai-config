use crate::support;
use hmac::{Hmac, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use std::fs;
use support::{change::*, *};

fn state(path: &std::path::Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn write_body_only_fixture(receipt: &Value) {
    // Re-create the original version-1 wire shape using only this disposable fixture's key.
    let path = std::path::Path::new(receipt["record"].as_str().unwrap());
    let directory = path.parent().unwrap();
    let mut record = state(path);
    assert!(record.as_object_mut().unwrap().remove("display").is_some());
    assert!(
        record
            .as_object_mut()
            .unwrap()
            .remove("intent_summary")
            .is_some()
    );
    for finding in record["findings"].as_array_mut().unwrap() {
        assert!(
            finding
                .as_object_mut()
                .unwrap()
                .remove("explanation")
                .is_some()
        );
    }
    let bytes = serde_json::to_vec(&record).unwrap();
    let key = fs::read(directory.parent().unwrap().join("signing-key")).unwrap();
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).unwrap();
    mac.update(directory.file_name().unwrap().as_encoded_bytes());
    mac.update(&bytes);
    fs::write(path, bytes).unwrap();
    fs::write(directory.join("report.mac"), mac.finalize().into_bytes()).unwrap();
}

#[test]
fn selection_preview_and_confirmation_publish_only_selected_comments_once() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    write_body_only_fixture(&receipt);
    let report = receipt["report"].as_str().unwrap();
    let outcome = terminal(
        &trial,
        &provider,
        report,
        &["exclude F2", "preview", "post"],
    );
    assert_eq!(outcome["code"], 0, "{}", outcome["output"]);
    let saved = state(&provider);
    assert_eq!(saved["posts"], 1);
    assert_eq!(saved["reviews"][0]["event"], "COMMENT");
    assert_eq!(saved["reviews"][0]["comments"].as_array().unwrap().len(), 1);
    let body = saved["reviews"][0]["comments"][0]["body"].as_str().unwrap();
    for section in [
        r"User\-facing problem",
        "Why it matters",
        "Technical details",
        "Suggested fix",
    ] {
        assert!(
            body.contains(section),
            "Missing published section: {section}"
        );
    }
    assert!(!saved["reviews"][0].to_string().contains("Excluded finding"));
    assert!(
        outcome["output"]
            .as_str()
            .unwrap()
            .contains("Exact GitHub request")
    );
    let repeated = terminal(&trial, &provider, report, &[]);
    assert_eq!(repeated["code"], 0, "{}", repeated["output"]);
    assert_eq!(state(&provider)["posts"], 1);
}

#[test]
fn cancellation_end_of_input_and_empty_selection_never_publish() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    for actions in [vec!["cancel"], vec![], vec!["exclude F1 F2", "post"]] {
        let outcome = terminal(
            &trial,
            &provider,
            receipt["report"].as_str().unwrap(),
            &actions,
        );
        assert_eq!(outcome["code"], 0, "{}", outcome["output"]);
        assert_eq!(state(&provider)["posts"], 0);
    }
}

#[test]
fn stale_revisions_and_modified_records_fail_without_publishing() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    let mut changed = state(&provider);
    changed["head"] = json!("a".repeat(40));
    put(&provider, changed.to_string());
    let outcome = terminal(
        &trial,
        &provider,
        receipt["report"].as_str().unwrap(),
        &["post"],
    );
    assert_eq!(outcome["code"], 1);
    assert_eq!(state(&provider)["posts"], 0);
    let mut record = state(std::path::Path::new(receipt["record"].as_str().unwrap()));
    record["findings"][0]["body"] = json!("Changed content");
    put(receipt["record"].as_str().unwrap(), record.to_string());
    let outcome = terminal(
        &trial,
        &provider,
        receipt["report"].as_str().unwrap(),
        &["post"],
    );
    assert_eq!(outcome["code"], 1);
    assert_eq!(state(&provider)["posts"], 0);
}

#[test]
fn lost_response_is_reconciled_without_a_second_submission() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    let mut changed = state(&provider);
    changed["lose"] = json!(true);
    put(&provider, changed.to_string());
    let outcome = terminal(
        &trial,
        &provider,
        receipt["report"].as_str().unwrap(),
        &["post"],
    );
    assert_eq!(outcome["code"], 1);
    assert_eq!(state(&provider)["posts"], 1);
    let recovered = terminal(&trial, &provider, receipt["report"].as_str().unwrap(), &[]);
    assert_eq!(recovered["code"], 0, "{}", recovered["output"]);
    assert_eq!(state(&provider)["posts"], 1);
}

#[test]
fn noninteractive_posting_refuses_without_a_provider_call() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    let output = command(&trial)
        .env("CHANGE_PROVIDER", &provider)
        .args(["post", receipt["report"].as_str().unwrap()])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(state(&provider)["posts"], 0);
}
