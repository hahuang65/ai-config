#[path = "support/event_peer.rs"]
mod event_peer;
mod support;
#[path = "support/waiter.rs"]
mod waiter;

use std::{
    io::{Read, Write},
    net::TcpStream,
    time::Duration,
};
use support::Review;

const IDLE_OBSERVATION: Duration = Duration::from_millis(150);
const RESPONSE_GUARD: Duration = Duration::from_secs(5);

fn waiting_request(review: &Review) -> TcpStream {
    let directory = std::fs::read_dir(review.root.join("state"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let descriptor: serde_json::Value =
        serde_json::from_slice(&std::fs::read(directory.join("server.json")).unwrap()).unwrap();
    let port = descriptor["port"].as_u64().unwrap();
    let capability = descriptor["capability"].as_str().unwrap();
    let mut stream = TcpStream::connect(("127.0.0.1", port as u16)).unwrap();
    stream.set_read_timeout(Some(IDLE_OBSERVATION)).unwrap();
    stream.set_write_timeout(Some(RESPONSE_GUARD)).unwrap();
    write!(stream, "GET /events?cursor=0&wait_ms=30000 HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {capability}\r\nConnection: close\r\n\r\n").unwrap();
    stream
}

fn render_with_legacy_digest(review: &Review) -> (std::path::PathBuf, Vec<u8>, serde_json::Value) {
    use base64::{Engine, engine::general_purpose::STANDARD};
    use sha2::{Digest, Sha256};
    let image = review.root.join("render.png");
    let mut bytes = STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRmkAAAAASUVORK5CYII=").unwrap();
    bytes.push(0);
    std::fs::write(&image, &bytes).unwrap();
    let source = "<html><body><img src=\"render.png\"></body></html>";
    std::fs::write(&review.file, source).unwrap();
    let first: serde_json::Value = review.request("/snapshot", None).json().unwrap();
    let mut digest = Sha256::new_with_prefix(source.as_bytes());
    digest.update(b"\0render\0image/png");
    digest.update((bytes.len() as u64).to_le_bytes());
    digest.update(&bytes);
    assert_eq!(first["revision"], format!("{:x}", digest.finalize()));
    (image, bytes, first)
}

#[test]
fn cached_render_dependencies_still_hash_current_bytes_and_reject_unsafe_replacements() {
    use base64::{Engine, engine::general_purpose::STANDARD};
    let review = Review::new();
    assert!(review.open().status.success());
    let (image, mut bytes, first) = render_with_legacy_digest(&review);
    let modified = std::fs::metadata(&image).unwrap().modified().unwrap();
    *bytes.last_mut().unwrap() = 1;
    std::fs::write(&image, &bytes).unwrap();
    std::fs::File::open(&image)
        .unwrap()
        .set_times(std::fs::FileTimes::new().set_modified(modified))
        .unwrap();
    let changed: serde_json::Value = review.request("/revision", None).json().unwrap();
    assert_ne!(
        first["revision"], changed["revision"],
        "same size and mtime cannot conceal changed render bytes"
    );
    let rendered: serde_json::Value = review.request("/snapshot", None).json().unwrap();
    assert_eq!(changed["revision"], rendered["revision"]);
    assert!(
        rendered["html"]
            .as_str()
            .unwrap()
            .contains(&STANDARD.encode(&bytes))
    );
    std::fs::remove_file(&image).unwrap();
    assert_eq!(review.request("/revision", None).status(), 503);
    assert!(review.poll()["current_revision"].is_null());
    std::os::unix::fs::symlink(&review.file, &image).unwrap();
    assert_eq!(review.request("/revision", None).status(), 503);
    std::fs::remove_file(&image).unwrap();
    std::fs::write(&image, &bytes).unwrap();
    assert_eq!(review.poll()["current_revision"], changed["revision"]);
}

#[test]
fn revision_checks_return_the_snapshot_identity_without_rendered_html() {
    let review = Review::new();
    assert!(review.open().status.success());
    let initial = review.poll();
    let response = review.request("/revision", None);
    assert_eq!(response.status(), 200);
    let revision: serde_json::Value = response.json().unwrap();
    assert_eq!(revision["revision"], initial["current_revision"]);
    assert!(revision.get("html").is_none());
    let snapshot: serde_json::Value = review.request("/snapshot", None).json().unwrap();
    assert_eq!(revision["revision"], snapshot["revision"]);
}

#[test]
fn a_terminal_review_returns_immediately_and_reply_retries_remain_idempotent() {
    let review = Review::new();
    assert!(review.open().status.success());
    let initial = review.poll();
    let revision = initial["current_revision"].as_str().unwrap();
    assert_eq!(review.submit("accept", "F1", revision).status(), 200);
    assert_eq!(review.submit("reject", "F2", revision).status(), 200);
    let closed = waiter::Waiter::new(&review, &["--cursor", "2"]).finish();
    assert_eq!(closed["status"], "decided");
    assert!(closed["events"].as_array().unwrap().is_empty());
    let args = [
        "--cursor",
        "2",
        "--reply",
        "Both decisions received",
        "--id",
        "wait-stable-reply-0001",
    ];
    let first = waiter::Waiter::new(&review, &args).finish();
    let retried = waiter::Waiter::new(&review, &args).finish();
    assert_eq!(first["events"], retried["events"]);
    assert_eq!(review.poll()["events"].as_array().unwrap().len(), 3);
}

#[test]
fn wait_rejects_invalid_arguments_and_cursors_instead_of_waiting_forever() {
    let review = Review::new();
    for args in [
        vec!["--reply", "Missing ID"],
        vec!["--reply", "Text", "--id", "short"],
        vec!["--cursor", "-1"],
        vec!["--timeout", "1"],
    ] {
        let mut command = vec!["wait", review.file.to_str().unwrap()];
        command.extend(args);
        let invalid = review.command(&command);
        assert_eq!(invalid.status.code(), Some(2));
        assert!(invalid.stdout.is_empty());
        assert!(!review.root.join("state").exists());
    }
    assert!(review.open().status.success());
    assert!(
        !waiter::Waiter::new(&review, &["--cursor", "99"])
            .failure()
            .is_empty()
    );
    for query in [
        "cursor=0&wait_ms=30001",
        "cursor=0&wait_ms=-1",
        "cursor=0&wait_ms=1&wait_ms=2",
    ] {
        assert_eq!(
            review.request(&format!("/events?{query}"), None).status(),
            400
        );
    }
}

#[test]
fn stopping_the_server_releases_an_indefinite_wait_without_an_outcome() {
    let review = Review::new();
    assert!(review.open().status.success());
    let mut child = waiter::Waiter::new(&review, &[]);
    let mut observer = waiting_request(&review);
    assert!(observer.read(&mut [0; 1]).is_err());
    assert!(child.running());
    assert!(
        review
            .command(&["stop", review.file.to_str().unwrap()])
            .status
            .success()
    );
    assert!(!child.failure().is_empty());
    assert!(review.open().status.success());
    assert!(review.poll()["events"].as_array().unwrap().is_empty());
}

#[test]
fn an_interrupted_wait_can_resume_without_consuming_saved_feedback() {
    let review = Review::new();
    assert!(review.open().status.success());
    let initial = review.poll();
    let mut child = waiter::Waiter::new(&review, &[]);
    let mut observer = waiting_request(&review);
    assert!(observer.read(&mut [0; 1]).is_err());
    assert!(child.running());
    child.interrupt();
    child.failure();
    assert_eq!(
        review
            .submit(
                "accept",
                "F1",
                initial["current_revision"].as_str().unwrap()
            )
            .status(),
        200
    );
    let saved = waiter::Waiter::new(&review, &[]).finish();
    let replay = waiter::Waiter::new(&review, &[]).finish();
    assert_eq!(saved["events"], replay["events"]);
    assert_eq!(saved["events"].as_array().unwrap().len(), 1);
    assert_eq!(review.poll()["status"], "open");
}

#[test]
fn a_timed_out_response_body_is_retried_without_losing_the_cursor() {
    let review = Review::new();
    let peer = event_peer::EventPeer::new(&review);
    let mut child = waiter::Waiter::bounded(&review);
    let _stalled = event_peer::EventPeer::hold_body(peer.request());
    let retry = peer.request();
    assert!(child.running());
    event_peer::EventPeer::respond(retry, serde_json::json!([]));
    let page = child.finish();
    assert_eq!(page["cursor"], 0);
    assert_eq!(page["status"], "open");
}

#[test]
fn empty_transport_heartbeats_do_not_finish_the_logical_wait() {
    let review = Review::new();
    let peer = event_peer::EventPeer::new(&review);
    let mut child = waiter::Waiter::new(&review, &[]);
    for _ in 0..3 {
        event_peer::EventPeer::respond(peer.request(), serde_json::json!([]));
    }
    let waiting = peer.request();
    assert!(child.running());
    event_peer::EventPeer::respond(
        waiting,
        serde_json::json!([{
            "cursor":1,"id":"synthetic-feedback-0001","action":"feedback",
            "revision":"0".repeat(64),"message":"Continue now","annotations":[],
        }]),
    );
    assert_eq!(child.finish()["events"][0]["message"], "Continue now");
}

#[test]
fn the_foreground_wait_command_stays_active_and_returns_saved_feedback() {
    let review = Review::new();
    assert!(review.open().status.success());
    let initial = review.poll();
    let revision = initial["current_revision"].as_str().unwrap();
    let mut child = waiter::Waiter::new(&review, &[]);
    let mut observer = waiting_request(&review);
    assert!(observer.read(&mut [0; 1]).is_err());
    assert!(
        child.running(),
        "wait must not finish just because there is no feedback"
    );
    assert_eq!(review.submit("accept", "F1", revision).status(), 200);
    let page = child.finish();
    assert_eq!(page["events"][0]["finding"], "F1");
    assert_eq!(page["events"][0]["action"], "accept");
    assert_eq!(page["cursor"], review.poll()["cursor"]);
}

#[test]
fn an_idle_request_waits_until_a_durable_finding_decision_arrives() {
    let review = Review::new();
    assert!(review.open().status.success());
    let initial = review.poll();
    let revision = initial["current_revision"].as_str().unwrap();
    let mut stream = waiting_request(&review);
    let mut second = waiting_request(&review);
    let error = stream
        .read(&mut [0; 1])
        .expect_err("idle request must remain open without an empty response");
    assert!(matches!(
        error.kind(),
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
    ));
    assert_eq!(review.submit("accept", "F1", revision).status(), 200);
    stream.set_read_timeout(Some(RESPONSE_GUARD)).unwrap();
    let mut response = String::new();
    stream.read_to_string(&mut response).unwrap();
    second.set_read_timeout(Some(RESPONSE_GUARD)).unwrap();
    let mut other_response = String::new();
    second.read_to_string(&mut other_response).unwrap();
    assert_eq!(
        response.split_once("\r\n\r\n").unwrap().1,
        other_response.split_once("\r\n\r\n").unwrap().1
    );
    assert!(response.starts_with("HTTP/1.1 200"));
    let page: serde_json::Value =
        serde_json::from_str(response.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(page["events"][0]["finding"], "F1");
    assert_eq!(page["events"][0]["action"], "accept");
    assert_eq!(page["cursor"], review.poll()["cursor"]);
}
