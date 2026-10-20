mod support;
use serde_json::json;
use support::Review;

#[test]
fn a_new_native_prompt_can_abandon_active_feedback_without_completing_it() {
    let review = Review::new();
    assert!(review.open().status.success());
    let origin = json!({"harness":"claude","conversation":"prompt-boundary-fixture","workspace":review.root});
    assert_eq!(
        review.request("/feedback/attach", Some(&origin)).status(),
        200
    );
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
    let command = |verb: &str| {
        review.command(&[
            verb,
            "--harness",
            "claude",
            "--conversation",
            "prompt-boundary-fixture",
            "--workspace",
            review.root.to_str().unwrap(),
        ])
    };
    let claimed = review.command(&[
        "claim",
        review.file.to_str().unwrap(),
        "--harness",
        "claude",
        "--conversation",
        "prompt-boundary-fixture",
        "--workspace",
        review.root.to_str().unwrap(),
    ]);
    assert!(claimed.status.success());
    let active = command("active");
    assert!(
        active.status.success(),
        "{}",
        String::from_utf8_lossy(&active.stderr)
    );
    let entries: serde_json::Value = serde_json::from_slice(&active.stdout).unwrap();
    assert_eq!(entries["active"].as_array().unwrap().len(), 1);
    assert!(command("abandon").status.success());
    assert_eq!(review.poll()["processing"]["state"], "needs_attention");
    let cleared: serde_json::Value = serde_json::from_slice(&command("active").stdout).unwrap();
    assert_eq!(cleared["active"], json!([]));
    assert_eq!(review.poll()["events"].as_array().unwrap().len(), 1);
}

#[test]
fn an_interrupted_response_retains_feedback_and_rejects_its_old_completion() {
    let review = Review::new();
    assert!(review.open().status.success());
    let origin =
        json!({"harness":"pi","conversation":"interrupted-fixture","workspace":review.root});
    assert_eq!(
        review.request("/feedback/attach", Some(&origin)).status(),
        200
    );
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
    assert_eq!(review.submit("reject", "F2", &revision).status(), 200);
    let job: serde_json::Value = review
        .request("/feedback/claim", Some(&origin))
        .json()
        .unwrap();
    let renewed = review.command(&[
        "renew",
        review.file.to_str().unwrap(),
        "--cursor",
        &job["cursor"].to_string(),
        "--attempt",
        job["attempt"].as_str().unwrap(),
    ]);
    assert!(
        renewed.status.success(),
        "{}",
        String::from_utf8_lossy(&renewed.stderr)
    );
    let failed = review.command(&[
        "fail",
        review.file.to_str().unwrap(),
        "--cursor",
        &job["cursor"].to_string(),
        "--attempt",
        job["attempt"].as_str().unwrap(),
    ]);
    assert!(
        failed.status.success(),
        "{}",
        String::from_utf8_lossy(&failed.stderr)
    );
    let state = review.poll();
    assert_eq!(state["processing"]["state"], "needs_attention");
    assert_eq!(state["processing"]["pending"], 2);
    let completion =
        json!({"cursor":job["cursor"],"attempt":job["attempt"],"message":"Stale response"});
    assert_eq!(
        review
            .request("/feedback/finish", Some(&completion))
            .status(),
        409
    );
}

#[test]
fn automatic_attachment_requires_a_fresh_receipt_for_that_opened_artifact() {
    let review = Review::new();
    let opened = review.open();
    assert!(opened.status.success());
    let receipt: serde_json::Value = serde_json::from_slice(&opened.stdout).unwrap();
    assert_eq!(receipt["review_feedback"]["version"], 1);
    let token = receipt["review_feedback"]["ticket"].as_str().unwrap();
    let attach = |ticket: &str, conversation: &str| {
        review.command(&[
            "attach",
            review.file.to_str().unwrap(),
            "--harness",
            "pi",
            "--conversation",
            conversation,
            "--workspace",
            review.root.to_str().unwrap(),
            "--ticket",
            ticket,
        ])
    };
    assert!(
        !attach("00000000000000000000000000000000", "automatic-attachment")
            .status
            .success()
    );
    assert!(attach(token, "automatic-attachment").status.success());
    assert!(
        attach(token, "automatic-attachment").status.success(),
        "Retrying the same attachment is idempotent"
    );
    assert!(
        !attach(token, "another-conversation").status.success(),
        "Receipt replay cannot reroute another conversation"
    );
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
}

#[test]
fn a_native_listener_delivers_each_saved_event_once_without_a_foreground_agent_wait() {
    let review = Review::new();
    assert!(review.open().status.success());
    let origin =
        json!({"harness":"pi","conversation":"busy-agent-fixture","workspace":review.root});
    assert_eq!(
        review.request("/feedback/attach", Some(&origin)).status(),
        200
    );
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
    let listen = || {
        let output = review.command(&[
            "listen",
            "--harness",
            "pi",
            "--conversation",
            "busy-agent-fixture",
            "--workspace",
            review.root.to_str().unwrap(),
            "--seconds",
            "0",
        ]);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        serde_json::from_slice::<serde_json::Value>(&output.stdout).unwrap()
    };
    let delivered = listen();
    assert_eq!(delivered["state"], "feedback");
    assert_eq!(
        delivered["artifact"],
        json!(review.file.canonicalize().unwrap())
    );
    assert_eq!(delivered["pending"]["event"]["action"], "accept");
    assert_eq!(review.poll()["processing"]["state"], "queued");
    assert_eq!(
        listen()["state"],
        "renew",
        "Do not enqueue duplicate follow-ups while the agent is busy"
    );
    let reset = review.command(&[
        "attached",
        "--harness",
        "pi",
        "--conversation",
        "busy-agent-fixture",
        "--workspace",
        review.root.to_str().unwrap(),
        "--reset-notifications",
    ]);
    assert!(
        reset.status.success(),
        "{}",
        String::from_utf8_lossy(&reset.stderr)
    );
    assert_eq!(
        listen()["state"],
        "feedback",
        "A resumed conversation must recover unclaimed feedback"
    );
    assert_eq!(review.poll()["events"].as_array().unwrap().len(), 1);
}

#[test]
fn notifying_a_busy_agent_does_not_claim_that_feedback_is_working() {
    let review = Review::new();
    assert!(review.open().status.success());
    let origin =
        json!({"harness":"pi","conversation":"busy-agent-fixture","workspace":review.root});
    assert_eq!(
        review.request("/feedback/attach", Some(&origin)).status(),
        200
    );
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
    let response = review.request("/feedback/pending", Some(&origin));
    assert_eq!(response.status(), 200);
    let pending: serde_json::Value = response.json().unwrap();
    assert_eq!(pending["event"]["action"], "accept");
    assert!(pending.get("attempt").is_none());
    assert_eq!(review.poll()["processing"]["state"], "queued");
    let claimed: serde_json::Value = review
        .request("/feedback/claim", Some(&origin))
        .json()
        .unwrap();
    assert_eq!(claimed["cursor"], pending["cursor"]);
    assert_eq!(review.poll()["processing"]["state"], "working");
    let next: serde_json::Value = review
        .request("/feedback/pending", Some(&origin))
        .json()
        .unwrap();
    assert!(
        next.is_null(),
        "Do not deliver another job while this artifact is processing"
    );
}
