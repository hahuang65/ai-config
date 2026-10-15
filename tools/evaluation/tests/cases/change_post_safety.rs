use crate::support;
use serde_json::{Value, json};
use std::fs;
use support::{change::*, *};

fn state(path: &std::path::Path) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

#[test]
fn a_revision_change_during_account_lookup_is_detected_before_submission() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    let mut changed = state(&provider);
    changed["change_on_user"] = json!(true);
    put(&provider, changed.to_string());
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
fn changed_html_is_not_presented_as_the_signed_review_result() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    put(
        receipt["report"].as_str().unwrap(),
        "<h1>Different findings</h1>",
    );
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
fn declining_or_closing_final_confirmation_does_not_publish() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    for action in ["DECLINE", "EOF_CONFIRM"] {
        let outcome = terminal(
            &trial,
            &provider,
            receipt["report"].as_str().unwrap(),
            &["post", action],
        );
        assert_eq!(outcome["code"], 0, "{}", outcome["output"]);
        assert_eq!(state(&provider)["posts"], 0);
    }
}

#[test]
fn unresolved_uncertainty_never_causes_a_second_submission() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    let mut changed = state(&provider);
    changed["lose"] = json!(true);
    put(&provider, changed.to_string());
    assert_eq!(
        terminal(
            &trial,
            &provider,
            receipt["report"].as_str().unwrap(),
            &["post"]
        )["code"],
        1
    );
    let mut changed = state(&provider);
    changed["reviews"] = json!([]);
    put(&provider, changed.to_string());
    assert_eq!(
        terminal(&trial, &provider, receipt["report"].as_str().unwrap(), &[])["code"],
        1
    );
    assert_eq!(state(&provider)["posts"], 1);
}

#[test]
fn a_second_terminal_cannot_publish_while_another_session_owns_the_report() {
    let trial = fixture();
    let provider = provider(&trial);
    let receipt = pull(&trial, &provider);
    let parent = std::path::Path::new(receipt["report"].as_str().unwrap())
        .parent()
        .unwrap();
    let lock = fs::File::create(parent.join("post.lock")).unwrap();
    fs2::FileExt::lock_exclusive(&lock).unwrap();
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
fn every_frozen_identity_component_is_checked_again_before_posting() {
    for (key, value) in [
        ("base", json!("a".repeat(40))),
        ("pull_id", json!(71)),
        ("repo_id", json!(10)),
        ("number", json!(8)),
        ("state", json!("closed")),
        ("url", json!("https://github.com/other/repo/pull/7")),
    ] {
        let trial = fixture();
        let provider = provider(&trial);
        let receipt = pull(&trial, &provider);
        let mut changed = state(&provider);
        changed[key] = value;
        put(&provider, changed.to_string());
        assert_eq!(
            terminal(
                &trial,
                &provider,
                receipt["report"].as_str().unwrap(),
                &["post"]
            )["code"],
            1,
            "field {key}"
        );
        assert_eq!(state(&provider)["posts"], 0);
    }
}
