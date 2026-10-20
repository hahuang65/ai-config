mod support;
use serde_json::json;
use support::Review;

fn origin(review: &Review) -> serde_json::Value {
    json!({"harness":"pi","conversation":"feedback-fixture-conversation","workspace":review.root})
}

fn claim(review: &Review) -> serde_json::Value {
    let response = review.request("/feedback/claim", Some(&origin(review)));
    assert_eq!(response.status(), 200);
    response.json().unwrap()
}

fn completion(job: &serde_json::Value) -> serde_json::Value {
    json!({"cursor":job["cursor"],"attempt":job["attempt"],"message":"Feedback answered."})
}

#[test]
fn native_adapters_can_claim_and_complete_feedback_through_the_cli() {
    let review = Review::new();
    assert!(review.open().status.success());
    assert_eq!(
        review
            .request("/feedback/attach", Some(&origin(&review)))
            .status(),
        200
    );
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
    let output = review.command(&[
        "claim",
        review.file.to_str().unwrap(),
        "--harness",
        "pi",
        "--conversation",
        "feedback-fixture-conversation",
        "--workspace",
        review.root.to_str().unwrap(),
    ]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let job: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(job["event"]["action"], "accept");
    let finished = review.command(&[
        "finish",
        review.file.to_str().unwrap(),
        "--cursor",
        &job["cursor"].to_string(),
        "--attempt",
        job["attempt"].as_str().unwrap(),
        "--message",
        "The accepted finding has been explained.",
    ]);
    assert!(
        finished.status.success(),
        "{}",
        String::from_utf8_lossy(&finished.stderr)
    );
    assert_eq!(review.poll()["processing"]["state"], "answered");
}

#[test]
fn a_resumed_agent_discovers_only_its_own_attached_artifacts() {
    let review = Review::new();
    assert!(review.open().status.success());
    assert_eq!(
        review
            .request("/feedback/attach", Some(&origin(&review)))
            .status(),
        200
    );
    let list = |conversation: &str| {
        let output = review.command(&[
            "attached",
            "--harness",
            "pi",
            "--conversation",
            conversation,
            "--workspace",
            review.root.to_str().unwrap(),
        ]);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()
    };
    let expected = json!([review.file.canonicalize().unwrap()]);
    assert_eq!(list("feedback-fixture-conversation")["artifacts"], expected);
    assert!(
        review
            .command(&["stop", review.file.to_str().unwrap()])
            .status
            .success()
    );
    assert_eq!(list("feedback-fixture-conversation")["artifacts"], expected);
    assert_eq!(list("another-conversation")["artifacts"], json!([]));
}

#[test]
fn agent_feedback_is_durably_queued_without_a_foreground_wait() {
    let review = Review::new();
    assert!(review.open().status.success());
    let attached = review.command(&[
        "attach",
        review.file.to_str().unwrap(),
        "--harness",
        "pi",
        "--conversation",
        "feedback-fixture-conversation",
        "--workspace",
        review.root.to_str().unwrap(),
    ]);
    assert!(
        attached.status.success(),
        "{}",
        String::from_utf8_lossy(&attached.stderr)
    );
    let original = review.poll();
    let revision = original["current_revision"].as_str().unwrap();
    let feedback = json!({"id":"feedback-without-wait-0001","action":"feedback",
        "revision":revision,"message":"Please explain this finding.","annotations":[]});
    assert_eq!(review.submit_payload(&feedback).status(), 200);
    let queued = review.poll();
    assert_eq!(queued["processing"]["state"], "queued");
    assert_eq!(queued["processing"]["pending"], 1);
    assert!(
        review
            .command(&["stop", review.file.to_str().unwrap()])
            .status
            .success()
    );
    assert!(review.open().status.success());
    let restored = review.poll();
    assert_eq!(restored["processing"]["state"], "queued");
    assert_eq!(restored["processing"]["pending"], 1);
}

#[test]
fn server_restart_retains_interrupted_feedback_without_staying_working() {
    let review = Review::new();
    assert!(review.open().status.success());
    assert_eq!(
        review
            .request("/feedback/attach", Some(&origin(&review)))
            .status(),
        200
    );
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
    let original = claim(&review);
    assert_eq!(review.poll()["processing"]["state"], "working");
    assert!(
        review
            .command(&["stop", review.file.to_str().unwrap()])
            .status
            .success()
    );
    assert!(review.open().status.success());
    let interrupted = review.poll();
    assert_eq!(interrupted["processing"]["state"], "needs_attention");
    assert_eq!(interrupted["processing"]["pending"], 1);
    let retried = claim(&review);
    assert_ne!(retried["attempt"], original["attempt"]);
    assert_eq!(
        review
            .request("/feedback/finish", Some(&completion(&original)))
            .status(),
        409
    );
    assert_eq!(
        review
            .request("/feedback/finish", Some(&completion(&retried)))
            .status(),
        200
    );
    assert_eq!(review.poll()["processing"]["state"], "answered");
}

#[test]
fn only_the_originating_agent_can_claim_feedback_and_finish_it_once() {
    let review = Review::new();
    assert!(review.open().status.success());
    let owner = origin(&review);
    assert_eq!(
        review.request("/feedback/attach", Some(&owner)).status(),
        200
    );
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
    let mut other = owner.clone();
    other["conversation"] = json!("another-conversation");
    assert_eq!(
        review.request("/feedback/claim", Some(&other)).status(),
        409
    );
    assert_eq!(review.poll()["processing"]["state"], "queued");
    let job = claim(&review);
    assert_eq!(job["event"]["action"], "accept");
    assert_eq!(review.poll()["processing"]["state"], "working");
    finish_exactly_once(&review, &job);
}

fn finish_exactly_once(review: &Review, job: &serde_json::Value) {
    let mut completion = completion(job);
    let token = completion["attempt"].clone();
    completion["attempt"] = json!("00000000000000000000000000000000");
    assert_eq!(
        review
            .request("/feedback/finish", Some(&completion))
            .status(),
        409
    );
    completion["attempt"] = token;
    assert_eq!(
        review
            .request("/feedback/finish", Some(&completion))
            .status(),
        200
    );
    assert_eq!(
        review
            .request("/feedback/finish", Some(&completion))
            .status(),
        200
    );
    let answered = review.poll();
    assert_eq!(answered["processing"]["state"], "answered");
    assert_eq!(answered["processing"]["pending"], 0);
    assert_eq!(
        answered["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|event| event["action"] == "reply")
            .count(),
        1
    );
}
