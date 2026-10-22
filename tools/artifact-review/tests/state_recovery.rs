#[allow(dead_code)]
mod support;
use serde_json::Value;
use std::{path::PathBuf, process::Output};
use support::Review;

struct Destination<'a> {
    review: &'a Review,
    root: PathBuf,
}

impl<'a> Destination<'a> {
    fn new(review: &'a Review) -> Self {
        Self {
            review,
            root: review.root.join("shared-state"),
        }
    }
    fn command(&self, args: &[&str]) -> Output {
        self.review.command_with_root(&self.root, args)
    }
    fn recover(&self) -> Output {
        self.command(&[
            "recover-state",
            self.review.file.to_str().unwrap(),
            "--from-root",
            self.review.root.join("state").to_str().unwrap(),
        ])
    }
    fn open(&self) {
        let result = self.command(&[
            "open",
            self.review.file.to_str().unwrap(),
            "--findings",
            self.review.record.to_str().unwrap(),
            "--no-browser",
        ]);
        assert!(
            result.status.success(),
            "{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }
    fn poll(&self) -> Value {
        let result = self.command(&["poll", self.review.file.to_str().unwrap(), "--timeout", "0"]);
        assert!(result.status.success());
        serde_json::from_slice(&result.stdout).unwrap()
    }
    fn origin(&self, action: &str) -> Output {
        self.command(&[
            action,
            self.review.file.to_str().unwrap(),
            "--harness",
            "pi",
            "--conversation",
            "state-recovery-fixture",
            "--workspace",
            std::env::current_dir().unwrap().to_str().unwrap(),
        ])
    }
}

impl Drop for Destination<'_> {
    fn drop(&mut self) {
        self.command(&["stop", self.review.file.to_str().unwrap()]);
    }
}

fn accept(review: &Review) -> String {
    assert!(review.open().status.success());
    let revision = review.poll()["current_revision"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(review.submit("accept", "F1", &revision).status(), 200);
    revision
}

fn stop(review: &Review) {
    assert!(
        review
            .command(&["stop", review.file.to_str().unwrap()])
            .status
            .success()
    );
}

#[test]
fn recovery_preserves_an_accepted_finding_for_the_original_native_responder() {
    let review = Review::new();
    let destination = Destination::new(&review);
    let revision = accept(&review);
    stop(&review);
    let recovered = destination.recover();
    assert!(
        recovered.status.success(),
        "{}",
        String::from_utf8_lossy(&recovered.stderr)
    );
    destination.open();
    let state = destination.poll();
    assert_eq!(state["finding_review"]["items"][0]["decision"], "accept");
    assert_eq!(state["events"][0]["cursor"], 1);
    assert_eq!(state["events"][0]["revision"], revision);
    assert!(destination.origin("attach").status.success());
    let output = destination.origin("claim");
    assert!(output.status.success());
    let job: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(job["event"]["action"], "accept");
    assert_eq!(job["event"]["finding"], "F1");
    assert_eq!(job["stale"], false);
    assert!(
        !destination.recover().status.success(),
        "A second recovery must not duplicate the queue"
    );
}

#[test]
fn recovery_refuses_a_live_source_without_consuming_its_acceptance() {
    let review = Review::new();
    let destination = Destination::new(&review);
    accept(&review);
    assert!(!destination.recover().status.success());
    assert_eq!(
        review.poll()["finding_review"]["items"][0]["decision"],
        "accept"
    );
}

#[test]
fn recovery_never_overwrites_a_destination_review() {
    let review = Review::new();
    let destination = Destination::new(&review);
    accept(&review);
    stop(&review);
    destination.open();
    assert!(!destination.recover().status.success());
    assert_eq!(destination.poll()["events"].as_array().unwrap().len(), 0);
    assert!(review.open().status.success());
    assert_eq!(
        review.poll()["finding_review"]["items"][0]["decision"],
        "accept"
    );
}

#[test]
fn recovery_refuses_an_active_native_claim_even_after_server_shutdown() {
    let review = Review::new();
    let destination = Destination::new(&review);
    accept(&review);
    let workspace = std::env::current_dir().unwrap();
    for action in ["attach", "claim"] {
        let output = review.command(&[
            action,
            review.file.to_str().unwrap(),
            "--harness",
            "pi",
            "--conversation",
            "state-recovery-fixture",
            "--workspace",
            workspace.to_str().unwrap(),
        ]);
        assert!(output.status.success());
    }
    stop(&review);
    let result = destination.recover();
    assert!(!result.status.success());
    assert!(String::from_utf8_lossy(&result.stderr).contains("active feedback claim"));
}

#[test]
fn recovery_refuses_a_linked_source_root_without_touching_the_queue() {
    let review = Review::new();
    let destination = Destination::new(&review);
    accept(&review);
    stop(&review);
    let linked = review.root.join("linked-state");
    std::os::unix::fs::symlink(review.root.join("state"), &linked).unwrap();
    let result = destination.command(&[
        "recover-state",
        review.file.to_str().unwrap(),
        "--from-root",
        linked.to_str().unwrap(),
    ]);
    assert!(!result.status.success());
    assert!(review.open().status.success());
    assert_eq!(
        review.poll()["finding_review"]["items"][0]["decision"],
        "accept"
    );
}
