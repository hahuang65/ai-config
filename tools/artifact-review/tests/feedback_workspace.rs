mod support;
use serde_json::{Value, json};
use std::{path::Path, process::Output};
use support::Review;

fn native(review: &Review, verb: &str, workspace: &Path) -> Output {
    let mut args = vec![verb];
    if verb == "claim" {
        args.push(review.file.to_str().unwrap());
    }
    args.extend([
        "--harness",
        "claude",
        "--conversation",
        "workspace-fixture",
        "--workspace",
        workspace.to_str().unwrap(),
    ]);
    if verb == "listen" {
        args.extend(["--seconds", "0"]);
    }
    review.command(&args)
}

fn delivery(review: &Review) -> Value {
    let output = native(review, "listen", &review.root);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn inactive_workspaces_cannot_notify_or_claim_and_reentry_redelivers_unclaimed_feedback() {
    let review = Review::new();
    assert!(review.open().status.success());
    let origin =
        json!({"harness":"claude","conversation":"workspace-fixture","workspace":review.root});
    assert_eq!(
        review.request("/feedback/attach", Some(&origin)).status(),
        200
    );
    assert!(native(&review, "focus", &review.root).status.success());
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
    assert_eq!(delivery(&review)["state"], "feedback");
    let wrong_cwd = native(&review, "claim", &review.root);
    assert!(
        !wrong_cwd.status.success(),
        "a stale literal claim command must not claim from another cwd"
    );
    assert_eq!(review.poll()["processing"]["state"], "queued");
    let primary = review.root.join("primary");
    std::fs::create_dir(&primary).unwrap();
    assert!(native(&review, "focus", &primary).status.success());
    assert_eq!(delivery(&review)["state"], "idle");
    assert_eq!(
        review.request("/feedback/claim", Some(&origin)).status(),
        409
    );
    assert!(native(&review, "focus", &review.root).status.success());
    assert_eq!(delivery(&review)["state"], "feedback");
    assert_eq!(delivery(&review)["state"], "renew");
    let claimed: Value = review
        .request("/feedback/claim", Some(&origin))
        .json()
        .unwrap();
    assert_eq!(claimed["cursor"], 1);
    assert_eq!(review.poll()["processing"]["state"], "working");
}
