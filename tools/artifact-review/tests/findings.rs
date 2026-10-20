mod support;
use serde_json::json;
use support::Review;

fn legacy_state(
    review: &Review,
    revision: &str,
) -> (rusqlite::Connection, String, serde_json::Value) {
    let directory = std::fs::read_dir(review.root.join("state"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let database = rusqlite::Connection::open(directory.join("events.sqlite")).unwrap();
    let encoded: String = database
        .query_row("SELECT findings FROM configuration WHERE id=1", [], |row| {
            row.get(0)
        })
        .unwrap();
    let mut legacy: serde_json::Value = serde_json::from_str(&encoded).unwrap();
    legacy.as_object_mut().unwrap().remove("publication_only");
    database
        .execute(
            "UPDATE configuration SET findings=?1 WHERE id=1",
            [legacy.to_string()],
        )
        .unwrap();
    let event = json!({"id":"legacy-pr-accept-0001","action":"accept","revision":revision,
        "message":"Historical decision","annotations":[],"finding":"F1"})
    .to_string();
    database
        .execute(
            "INSERT INTO events(id,payload,action) VALUES('legacy-pr-accept-0001',?1,'accept')",
            [&event],
        )
        .unwrap();
    (database, event, legacy)
}

#[test]
fn legacy_pr_configuration_is_upgraded_without_rewriting_saved_decisions() {
    let review = Review::new();
    let mut record: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&review.record).unwrap()).unwrap();
    record["scope"] = json!({"pull_request":{"number":7}});
    let original = record.to_string();
    std::fs::write(&review.record, &original).unwrap();
    assert!(review.open().status.success());
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert!(
        review
            .command(&["stop", review.file.to_str().unwrap()])
            .status
            .success()
    );
    let (database, event, legacy) = legacy_state(&review, &revision);
    assert!(
        review.open().status.success(),
        "The exact retained PR must remain reopenable"
    );
    let page = review.poll();
    assert_eq!(page["finding_review"]["publication_only"], true);
    assert_eq!(page["finding_review"]["items"][0]["decision"], "accept");
    assert_eq!(page["events"].as_array().unwrap().len(), 1);
    assert_eq!(page["status"], "open");
    assert_eq!(review.request("/findings", Some(&legacy)).status(), 409);
    assert_eq!(review.submit("accept", "F2", &revision).status(), 409);
    assert_eq!(std::fs::read_to_string(&review.record).unwrap(), original);
    let preserved: String = database
        .query_row(
            "SELECT payload FROM events WHERE id='legacy-pr-accept-0001'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(preserved, event);
}

#[test]
fn pull_request_reviews_allow_feedback_but_never_authorize_repairs() {
    let review = Review::new();
    let mut record: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&review.record).unwrap()).unwrap();
    record["scope"] = json!({"kind":"pull-request", "pull_request":{"number":7}});
    std::fs::write(&review.record, record.to_string()).unwrap();
    assert!(review.open().status.success());
    let page = review.poll();
    assert_eq!(page["finding_review"]["publication_only"], true);
    assert_eq!(page["status"], "open");
    let revision = page["current_revision"].as_str().unwrap();
    assert_eq!(review.submit("accept", "F1", revision).status(), 409);
    assert_eq!(review.submit("reject", "F2", revision).status(), 409);
    assert_eq!(
        review
            .submit_payload(
                &json!({"id":"pr-feedback-not-a-decision", "action":"feedback",
        "revision":revision,"message":"Please clarify the proposed comment.","annotations":[]})
            )
            .status(),
        200
    );
    assert_eq!(
        review.poll()["finding_review"]["items"][0]["decision"],
        json!(null)
    );
}

#[test]
fn an_empty_pr_review_keeps_agent_feedback_open() {
    let review = Review::new();
    let mut record: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&review.record).unwrap()).unwrap();
    record["scope"] = json!({"pull_request":{"number":7}});
    record["findings"] = json!([]);
    std::fs::write(&review.record, record.to_string()).unwrap();
    assert!(review.open().status.success());
    assert_eq!(review.poll()["status"], "open");
    assert_eq!(review.poll()["finding_review"]["publication_only"], true);
}

#[test]
fn changing_the_report_blocks_new_decisions_without_erasing_earlier_authority() {
    let review = Review::new();
    assert!(review.open().status.success());
    let initial = review.poll();
    let revision = initial["current_revision"].as_str().unwrap();
    assert_eq!(review.submit("accept", "F1", revision).status(), 200);
    std::fs::write(&review.file, "<html><body>A changed report</body></html>").unwrap();
    assert_eq!(review.submit("accept", "F2", revision).status(), 409);
    let changed = review.poll();
    assert_eq!(changed["events"].as_array().unwrap().len(), 1);
    assert_eq!(changed["finding_review"]["needs_review"], true);
    assert_eq!(changed["finding_review"]["items"][0]["decision"], "accept");
    assert_eq!(
        changed["finding_review"]["items"][1]["decision"],
        json!(null)
    );
    std::fs::remove_file(&review.file).unwrap();
    assert_eq!(review.submit("reject", "F2", revision).status(), 409);
    assert_eq!(review.poll()["current_revision"], json!(null));
}

#[test]
fn a_new_record_cannot_replace_an_existing_finding_review() {
    let review = Review::new();
    assert!(review.open().status.success());
    let original = review.poll();
    let revision = original["current_revision"].as_str().unwrap();
    assert_eq!(review.submit("accept", "F1", revision).status(), 200);
    let mut record: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&review.record).unwrap()).unwrap();
    record["findings"][0]["title"] = json!("Different finding with reused ID");
    std::fs::write(&review.record, record.to_string()).unwrap();
    assert!(!review.open().status.success());
    let retained = review.poll();
    assert_eq!(
        retained["finding_review"]["report_digest"],
        original["finding_review"]["report_digest"]
    );
    assert_eq!(retained["finding_review"]["items"][0]["title"], "First");
    assert_eq!(retained["finding_review"]["items"][0]["decision"], "accept");
    assert_eq!(retained["events"].as_array().unwrap().len(), 1);
}

#[test]
fn ending_a_partial_review_preserves_accepts_and_reopens_only_undecided_findings() {
    let review = Review::new();
    assert!(review.open().status.success());
    let page = review.poll();
    let revision = page["current_revision"].as_str().unwrap();
    assert_eq!(review.submit("accept", "F1", revision).status(), 200);
    assert_eq!(
        review
            .submit_payload(&json!({"id":"end-partial-review-0001", "action":"decline",
        "revision":revision,"message":"Stop here", "annotations":[]}))
            .status(),
        200
    );
    assert_eq!(review.submit("reject", "F2", revision).status(), 409);
    let closed = review.poll();
    assert_eq!(closed["status"], "declined");
    assert_eq!(closed["finding_review"]["items"][0]["decision"], "accept");
    assert_eq!(
        closed["finding_review"]["items"][1]["decision"],
        json!(null)
    );
    assert!(review.open().status.success());
    assert_eq!(review.submit("reject", "F1", revision).status(), 409);
    assert_eq!(review.submit("reject", "F2", revision).status(), 200);
    assert_eq!(review.poll()["status"], "decided");
}

#[test]
fn ordinary_artifacts_cannot_record_finding_decisions() {
    let review = Review::new();
    assert!(
        review
            .command(&["open", review.file.to_str().unwrap(), "--no-browser"])
            .status
            .success()
    );
    let page = review.poll();
    let revision = page["current_revision"].as_str().unwrap();
    assert!(page.get("finding_review").is_none());
    assert_eq!(review.submit("accept", "F1", revision).status(), 409);
    assert_eq!(
        review
            .submit_payload(&json!({"id":"ordinary-approval-0001", "action":"approve",
        "revision":revision,"message":"Approved artifact", "annotations":[]}))
            .status(),
        200
    );
    assert_eq!(review.poll()["needs_review"], false);
    assert!(
        !review.open().status.success(),
        "existing feedback must not change into finding authority"
    );
    assert_eq!(review.poll()["status"], "approved");
}

#[test]
fn oversized_and_symlinked_records_are_refused_without_starting_a_server() {
    let review = Review::new();
    std::fs::write(&review.record, vec![b' '; 25 * 1024 * 1024 + 1]).unwrap();
    assert_eq!(review.open().status.code(), Some(1));
    assert!(!review.root.join("state").exists());
    std::fs::remove_file(&review.record).unwrap();
    std::os::unix::fs::symlink(&review.file, &review.record).unwrap();
    assert_eq!(review.open().status.code(), Some(1));
    assert!(!review.root.join("state").exists());
}

#[test]
fn invalid_finding_lists_are_refused_before_creating_state() {
    for invalid in [
        json!([{"id":"F2","title":"Wrong first ID"}]),
        json!([{"id":"F1","title":"One"},{"id":"F1","title":"Duplicate"}]),
        json!([{"id":"F1","title":""}]),
        json!([{"id":"F1","title":"x".repeat(501)}]),
        json!([{"id":"F1","title":"unsafe\u{202e}control"}]),
        json!(
            (1..=51)
                .map(|n| json!({"id":format!("F{n}"),"title":"Too many"}))
                .collect::<Vec<_>>()
        ),
    ] {
        let review = Review::new();
        let mut record: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&review.record).unwrap()).unwrap();
        record["findings"] = invalid;
        std::fs::write(&review.record, record.to_string()).unwrap();
        let opened = review.open();
        assert_eq!(opened.status.code(), Some(1));
        assert!(opened.stdout.is_empty());
        assert!(!review.root.join("state").exists());
    }
}

#[test]
fn a_mismatched_report_cannot_create_review_state() {
    let review = Review::new();
    std::fs::write(&review.file, "<html><body>Different report</body></html>").unwrap();
    let opened = review.open();
    assert_eq!(opened.status.code(), Some(1));
    assert!(opened.stdout.is_empty());
    assert!(!review.root.join("state").exists());
}

#[test]
fn native_report_titles_with_line_breaks_remain_reviewable() {
    let review = Review::new();
    let mut record: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&review.record).unwrap()).unwrap();
    record["findings"][0]["title"] = json!("First\nwith a\ttab");
    std::fs::write(&review.record, record.to_string()).unwrap();
    let opened = review.open();
    assert!(
        opened.status.success(),
        "{}",
        String::from_utf8_lossy(&opened.stderr)
    );
    assert_eq!(
        review.poll()["finding_review"]["items"][0]["title"],
        "First\nwith a\ttab"
    );
}

#[test]
fn only_explicit_known_finding_decisions_can_authorize_repairs() {
    let review = Review::new();
    assert!(review.open().status.success());
    let page = review.poll();
    let revision = page["current_revision"].as_str().unwrap();
    let ordinary = json!({"id":"whole-report-request-0001", "action":"approve", "revision":revision,
        "message":"Do not treat whole-report approval as finding acceptance", "annotations":[]});
    assert_eq!(review.submit_payload(&ordinary).status(), 409);
    assert_eq!(review.submit("accept", "F3", revision).status(), 409);
    assert_eq!(review.submit("accept", "F51", revision).status(), 400);
    assert_eq!(review.submit("feedback", "F1", revision).status(), 400);
    let mut missing_id = ordinary.clone();
    missing_id["action"] = json!("accept");
    assert_eq!(review.submit_payload(&missing_id).status(), 400);
    assert!(review.poll()["events"].as_array().unwrap().is_empty());
    let mut feedback = ordinary;
    feedback["action"] = json!("feedback");
    assert_eq!(review.submit_payload(&feedback).status(), 200);
    let after = review.poll();
    assert_eq!(after["status"], "open");
    assert!(
        after["finding_review"]["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|item| item["decision"].is_null())
    );
}

#[test]
fn decisions_survive_restart_and_retry_without_replacing_authority() {
    let review = Review::new();
    assert!(review.open().status.success());
    let page = review.poll();
    let revision = page["current_revision"].as_str().unwrap();
    let accepted = json!({"id":"stable-accept-request-0001", "action":"accept", "finding":"F1",
        "revision":revision, "message":"Repair F1 only", "annotations":[]});
    let saved: serde_json::Value = review.submit_payload(&accepted).json().unwrap();
    assert!(
        review
            .command(&["stop", review.file.to_str().unwrap()])
            .status
            .success()
    );
    assert!(review.open().status.success());
    let retried: serde_json::Value = review.submit_payload(&accepted).json().unwrap();
    assert_eq!(retried, saved);
    assert_eq!(review.submit("reject", "F1", revision).status(), 409);
    let mut conflicting = accepted.clone();
    conflicting["action"] = json!("reject");
    assert_eq!(review.submit_payload(&conflicting).status(), 409);
    assert_eq!(review.submit("reject", "F2", revision).status(), 200);
    assert_eq!(review.submit_payload(&accepted).status(), 200);
    let finished = review.poll();
    assert_eq!(finished["events"].as_array().unwrap().len(), 2);
    assert_eq!(finished["finding_review"]["items"][0]["decision"], "accept");
    assert_eq!(finished["status"], "decided");
}

#[test]
fn each_finding_records_its_own_revision_bound_repair_decision() {
    let review = Review::new();
    let opened = review.open();
    assert!(
        opened.status.success(),
        "{}",
        String::from_utf8_lossy(&opened.stderr)
    );
    let initial = review.poll();
    let revision = initial["current_revision"].as_str().unwrap();
    assert_eq!(
        initial["finding_review"]["items"][0]["decision"],
        json!(null)
    );
    assert_eq!(review.submit("reject", "F2", revision).status(), 200);
    let partial = review.poll();
    assert_eq!(partial["status"], "open");
    assert_eq!(
        partial["finding_review"]["items"][0]["decision"],
        json!(null)
    );
    assert_eq!(partial["finding_review"]["items"][1]["decision"], "reject");
    assert_eq!(review.submit("accept", "F1", revision).status(), 200);
    let finished = review.poll();
    assert_eq!(finished["status"], "decided");
    assert_eq!(finished["finding_review"]["items"][0]["decision"], "accept");
    assert_eq!(finished["finding_review"]["needs_review"], false);
    assert_eq!(finished["finding_review"]["revision"], revision);
    assert_eq!(finished["events"][1]["finding"], "F1");
    assert_eq!(finished["events"][1]["revision"], revision);
    assert_eq!(finished["events"][1]["message"], "My decision");
    assert_eq!(finished["approved_revision"], json!(null));
}
