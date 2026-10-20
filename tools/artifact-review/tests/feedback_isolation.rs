mod support;
use serde_json::{Value, json};
use sha2::Digest;
use std::{
    fs,
    path::{Path, PathBuf},
    process::Output,
};
use support::Review;

struct Replacement<'a> {
    owner: &'a Review,
    file: PathBuf,
}

impl<'a> Replacement<'a> {
    fn new(owner: &'a Review) -> Self {
        let file = owner.root.join("z-replacement.html");
        let record = file.with_extension("json");
        fs::copy(&owner.file, &file).unwrap();
        fs::copy(&owner.record, &record).unwrap();
        assert!(
            owner
                .command(&[
                    "open",
                    file.to_str().unwrap(),
                    "--findings",
                    record.to_str().unwrap(),
                    "--no-browser"
                ])
                .status
                .success()
        );
        Self { owner, file }
    }

    fn submit(&self, revision: &str) {
        let artifact = self.file.canonicalize().unwrap();
        let key = format!(
            "{:x}",
            sha2::Sha256::digest(artifact.as_os_str().as_encoded_bytes())
        );
        let descriptor: Value = serde_json::from_slice(
            &fs::read(self.owner.root.join("state").join(key).join("server.json")).unwrap(),
        )
        .unwrap();
        let origin = format!("http://127.0.0.1:{}", descriptor["port"]);
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .timeout(std::time::Duration::from_secs(5))
            .build()
            .unwrap();
        let response = client.post(format!("{origin}/submit")).header("Origin", &origin)
            .bearer_auth(descriptor["capability"].as_str().unwrap())
            .json(&json!({"id":"replacement-feedback-0001","action":"accept","finding":"F1","revision":revision,"message":"","annotations":[]})).send().unwrap();
        assert_eq!(response.status(), 200);
    }
}

impl Drop for Replacement<'_> {
    fn drop(&mut self) {
        let _ = self.owner.command(&["stop", self.file.to_str().unwrap()]);
    }
}

fn native(review: &Review, verb: &str, file: Option<&Path>) -> Output {
    let mut args = vec![verb];
    if let Some(file) = file {
        args.push(file.to_str().unwrap());
    }
    args.extend([
        "--harness",
        "pi",
        "--conversation",
        "replacement-fixture",
        "--workspace",
        review.root.to_str().unwrap(),
    ]);
    if verb == "listen" {
        args.extend(["--seconds", "0"]);
    }
    review.command(&args)
}

fn assert_replacement(review: &Review, replacement: &Replacement<'_>) {
    let output = native(review, "listen", None);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let delivered: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(delivered["state"], "feedback");
    assert_eq!(
        delivered["artifact"],
        json!(replacement.file.canonicalize().unwrap())
    );
    assert_eq!(delivered["skipped_unavailable"], true);
}

#[test]
fn a_stopped_review_does_not_block_feedback_on_its_replacement() {
    let old = Review::new();
    assert!(old.open().status.success());
    let revision = old.poll()["current_revision"].as_str().unwrap().to_owned();
    let replacement = Replacement::new(&old);
    for file in [&old.file, &replacement.file] {
        assert!(native(&old, "attach", Some(file)).status.success());
    }
    assert!(
        old.command(&["stop", old.file.to_str().unwrap()])
            .status
            .success()
    );
    assert_eq!(old.submit("accept", "F1", &revision).status(), 200);
    assert_replacement(&old, &replacement);
    let old_state = old.root.join("state").join(format!(
        "{:x}",
        sha2::Sha256::digest(
            old.file
                .canonicalize()
                .unwrap()
                .as_os_str()
                .as_encoded_bytes()
        )
    ));
    assert!(
        !old_state.join("server.json").exists(),
        "Do not reopen the old review"
    );
}

#[test]
fn an_unavailable_old_active_lease_does_not_block_replacement_feedback() {
    let old = Review::new();
    assert!(old.open().status.success());
    assert!(native(&old, "attach", Some(&old.file)).status.success());
    let revision = old.poll()["current_revision"].as_str().unwrap().to_owned();
    assert_eq!(old.submit("accept", "F1", &revision).status(), 200);
    assert!(native(&old, "claim", Some(&old.file)).status.success());
    let replacement = Replacement::new(&old);
    assert!(
        native(&old, "attach", Some(&replacement.file))
            .status
            .success()
    );
    assert!(
        old.command(&["stop", old.file.to_str().unwrap()])
            .status
            .success()
    );
    assert_eq!(old.submit("accept", "F1", &revision).status(), 200);
    assert_replacement(&old, &replacement);
    let active: Value = serde_json::from_slice(&native(&old, "active", None).stdout).unwrap();
    assert_eq!(active["active"], json!([]));
}

#[test]
fn an_invalid_old_inbox_does_not_block_replacement_feedback() {
    let old = Review::new();
    assert!(old.open().status.success());
    assert!(native(&old, "attach", Some(&old.file)).status.success());
    let revision = old.poll()["current_revision"].as_str().unwrap().to_owned();
    assert_eq!(old.submit("accept", "F1", &revision).status(), 200);
    let replacement = Replacement::new(&old);
    assert!(
        native(&old, "attach", Some(&replacement.file))
            .status
            .success()
    );
    fs::remove_file(&old.file).unwrap();
    replacement.submit(&revision);
    assert_replacement(&old, &replacement);
}

#[test]
fn a_removed_old_directory_does_not_block_replacement_feedback() {
    let mut old = Review::new();
    let directory = old.root.join("a-obsolete");
    fs::create_dir(&directory).unwrap();
    let file = directory.join("report.html");
    let record = file.with_extension("json");
    fs::rename(&old.file, &file).unwrap();
    fs::rename(&old.record, &record).unwrap();
    old.file = file;
    old.record = record;
    assert!(old.open().status.success());
    assert!(native(&old, "attach", Some(&old.file)).status.success());
    let revision = old.poll()["current_revision"].as_str().unwrap().to_owned();
    assert_eq!(old.submit("accept", "F1", &revision).status(), 200);
    assert!(native(&old, "claim", Some(&old.file)).status.success());
    let replacement = Replacement::new(&old);
    assert!(
        native(&old, "attach", Some(&replacement.file))
            .status
            .success()
    );
    assert!(
        old.command(&["stop", old.file.to_str().unwrap()])
            .status
            .success()
    );
    fs::remove_dir_all(directory).unwrap();
    replacement.submit(&revision);
    assert_replacement(&old, &replacement);
    let active: Value = serde_json::from_slice(&native(&old, "active", None).stdout).unwrap();
    assert_eq!(active["active"], json!([]));
}
