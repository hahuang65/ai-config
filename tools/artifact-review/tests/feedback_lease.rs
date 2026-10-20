mod support;
use serde_json::{Value, json};
use support::Review;

#[test]
fn a_native_claude_listener_keeps_its_active_feedback_lease_alive() {
    let review = Review::new();
    assert!(review.open().status.success());
    let workspace = review.root.to_str().unwrap();
    let artifact = review.file.to_str().unwrap();
    let origin = [
        "--harness",
        "claude",
        "--conversation",
        "lease-fixture",
        "--workspace",
        workspace,
    ];
    let mut attach = vec!["attach", artifact];
    attach.extend(origin);
    assert!(review.command(&attach).status.success());
    let page = review.poll();
    assert_eq!(
        review
            .submit("accept", "F1", page["current_revision"].as_str().unwrap())
            .status(),
        200
    );
    let mut claim = vec!["claim", artifact];
    claim.extend(origin);
    let job: Value = serde_json::from_slice(&review.command(&claim).stdout).unwrap();
    let database = std::fs::read_dir(review.root.join("state"))
        .unwrap()
        .filter_map(Result::ok)
        .map(|entry| entry.path().join("events.sqlite"))
        .find(|path| path.is_file())
        .unwrap();
    let connection = rusqlite::Connection::open(database).unwrap();
    connection
        .execute(
            "UPDATE feedback_jobs SET lease_until=unixepoch()+2 WHERE cursor=?1",
            [job["cursor"].as_i64().unwrap()],
        )
        .unwrap();
    let mut listen = vec!["listen"];
    listen.extend(origin);
    listen.extend(["--seconds", "3"]);
    let delivery: Value = serde_json::from_slice(&review.command(&listen).stdout).unwrap();
    assert_eq!(delivery["state"], "renew");
    assert_eq!(review.poll()["processing"]["state"], "working");
    let finished = review.request("/feedback/finish", Some(&json!({"cursor":job["cursor"],"attempt":job["attempt"],"message":"Long response completed."})));
    assert_eq!(finished.status(), 200);
    assert_eq!(review.poll()["processing"]["state"], "answered");
}
