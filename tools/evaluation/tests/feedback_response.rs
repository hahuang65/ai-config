mod support;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, path::Path};
use support::*;

#[test]
fn a_retained_review_has_an_on_demand_snapshot_only_feedback_responder() {
    let trial = change::fixture();
    let generated = change::review(&trial, &["range", "HEAD~1..HEAD"]);
    success(generated.clone());
    let report: Value = serde_json::from_slice(&generated.stdout).unwrap();
    let html = report["report"].as_str().unwrap();
    let record = Path::new(html).with_extension("json");
    let original = fs::read(html).unwrap();
    let bytes = fs::read(record).unwrap();
    let bound: Value = serde_json::from_slice(&bytes).unwrap();
    executable(trial.fake_bin.join("pi"), RESPONDER);
    let output = trial.command().arg("feedback").arg(html).arg(format!("{:x}", Sha256::digest(&bytes)))
        .arg(bound["html_digest"].as_str().unwrap()).arg(json!({"action":"feedback","message":"Explain finding F1","revision":bound["html_digest"]}).to_string())
        .output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(
        response["reply"],
        "The frozen evidence supports this explanation. No source changes were made."
    );
    assert!(response["revision"].is_null());
    assert_eq!(fs::read(html).unwrap(), original);
    assert_eq!(
        fs::read(trial.temporary.path().join("repo/source.txt")).unwrap(),
        b"after\n"
    );
}

#[test]
fn cancelling_a_feedback_response_stops_its_restricted_process() {
    let trial = change::fixture();
    let generated = change::review(&trial, &["range", "HEAD~1..HEAD"]);
    success(generated.clone());
    let report: Value = serde_json::from_slice(&generated.stdout).unwrap();
    let html = report["report"].as_str().unwrap();
    let bytes = fs::read(Path::new(html).with_extension("json")).unwrap();
    let record: Value = serde_json::from_slice(&bytes).unwrap();
    let started = trial.temporary.path().join("responder-started");
    let finished = trial.temporary.path().join("responder-finished");
    let script = RESPONDER.replace("import os, json", "import os, json, time").replace("root = os.environ['PI_REVIEW_ROOT']", &format!(
        "open({}, 'w').close()\ntime.sleep(1)\nopen({}, 'w').close()\nroot = os.environ['PI_REVIEW_ROOT']",
        serde_json::to_string(&started).unwrap(), serde_json::to_string(&finished).unwrap()));
    executable(trial.fake_bin.join("pi"), &script);
    let output = trial
        .command()
        .arg("feedback")
        .arg(html)
        .arg(format!("{:x}", Sha256::digest(&bytes)))
        .arg(record["html_digest"].as_str().unwrap())
        .arg(
            json!({"action":"feedback","message":"Explain finding F1","fixture_started":started})
                .to_string(),
        )
        .output()
        .unwrap();
    assert!(
        !output.status.success(),
        "A cancelled responder cannot complete"
    );
    assert!(started.is_file());
    std::thread::sleep(std::time::Duration::from_millis(1100));
    assert!(!finished.exists(), "Cancelled responder survived its owner");
}

#[test]
fn standalone_browser_feedback_starts_a_read_only_responder_only_when_needed() {
    let trial = change::fixture();
    let generated = change::review(&trial, &["range", "HEAD~1..HEAD"]);
    success(generated.clone());
    let report: Value = serde_json::from_slice(&generated.stdout).unwrap();
    let html = report["report"].as_str().unwrap();
    let original = fs::read(html).unwrap();
    let marker = trial.temporary.path().join("responder-called");
    executable(
        trial.fake_bin.join("pi"),
        &RESPONDER.replace(
            "root = os.environ['PI_REVIEW_ROOT']",
            &format!(
                "open({}, 'w').close()\nroot = os.environ['PI_REVIEW_ROOT']",
                serde_json::to_string(&marker).unwrap()
            ),
        ),
    );
    let browser = Browser::new(&trial, html);
    success(browser.command(&[
        "open",
        html,
        "--findings",
        report["record"].as_str().unwrap(),
        "--standalone",
        "--no-browser",
    ]));
    let page = browser.poll();
    assert_eq!(page["finding_review"]["read_only"], true);
    assert_eq!(page["processing"]["responder"], "standalone");
    std::thread::sleep(std::time::Duration::from_millis(100));
    assert!(!marker.exists(), "An idle review must not call a model");
    assert!(browser.submit(&json!({"id":"standalone-accept-0001","action":"accept","finding":"F1","revision":page["current_revision"],"message":"","annotations":[]})).starts_with("HTTP/1.1 409"));
    assert!(browser.submit(&json!({"id":"standalone-feedback-0001","action":"feedback","revision":page["current_revision"],"message":"Explain finding F1","annotations":[]})).starts_with("HTTP/1.1 200"));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let mut page = browser.poll();
    while page["processing"]["state"] != "answered" && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(50));
        page = browser.poll();
    }
    assert_eq!(page["processing"]["state"], "answered");
    assert_eq!(
        page["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|event| event["action"] == "reply")
            .count(),
        1
    );
    assert!(marker.is_file());
    assert!(browser.submit(&json!({"id":"standalone-context-0002","action":"feedback","revision":page["current_revision"],"message":"Explain finding F1","annotations":[]})).starts_with("HTTP/1.1 200"));
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    while browser.poll()["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|event| event["action"] == "reply")
        .count()
        != 2
    {
        assert!(
            std::time::Instant::now() < deadline,
            "Follow-up did not receive its saved discussion context"
        );
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    assert_eq!(fs::read(html).unwrap(), original);
    assert_eq!(
        fs::read(trial.temporary.path().join("repo/source.txt")).unwrap(),
        b"after\n"
    );
}

#[test]
fn cli_opening_distinguishes_standalone_runs_from_agent_launched_runs() {
    for agent in [false, true] {
        let trial = change::fixture();
        let mut browser = Browser::new(&trial, "");
        executable(
            trial.fake_bin.join(if cfg!(target_os = "macos") {
                "open"
            } else {
                "xdg-open"
            }),
            "#!/bin/sh\nexit 0\n",
        );
        let mut command = change::command(&trial);
        command
            .current_dir(trial.temporary.path().join("repo"))
            .env("AR_ROOT", &browser.state)
            .env_remove("AI_REVIEW_AGENT_LAUNCHED")
            .env_remove("CLAUDECODE")
            .arg("HEAD~1..HEAD");
        if agent {
            command.env("CLAUDECODE", "1");
        }
        let output = command.output().unwrap();
        success(output.clone());
        let text = String::from_utf8(output.stdout).unwrap();
        browser.html = text
            .lines()
            .find_map(|line| {
                line.split_once("HTML report: ")
                    .map(|(_, path)| path.to_owned())
            })
            .unwrap();
        let page = browser.poll();
        assert_eq!(
            page["finding_review"]
                .get("read_only")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            !agent
        );
        assert_eq!(
            text.contains("\"review_feedback\""),
            agent,
            "Only agent-launched runs return a native attachment receipt"
        );
        assert_eq!(
            page["processing"]["responder"],
            if agent {
                Value::Null
            } else {
                json!("standalone")
            }
        );
    }
}

#[test]
fn a_failed_standalone_response_can_be_retried_without_repair_authority() {
    let trial = change::fixture();
    let generated = change::review(&trial, &["range", "HEAD~1..HEAD"]);
    success(generated.clone());
    let report: Value = serde_json::from_slice(&generated.stdout).unwrap();
    let html = report["report"].as_str().unwrap();
    let browser = Browser::new(&trial, html);
    executable(trial.fake_bin.join("pi"), "#!/bin/sh\nexit 19\n");
    success(browser.command(&[
        "open",
        html,
        "--findings",
        report["record"].as_str().unwrap(),
        "--standalone",
        "--no-browser",
    ]));
    let page = browser.poll();
    assert!(browser.submit(&json!({"id":"standalone-retry-0001","action":"feedback","revision":page["current_revision"],"message":"Explain finding F1","annotations":[]})).starts_with("HTTP/1.1 200"));
    let failed = browser.wait_state("needs_attention");
    assert_eq!(failed["processing"]["retry_cursor"], 1);
    executable(trial.fake_bin.join("pi"), RESPONDER);
    assert!(
        browser
            .request("/feedback/retry", &json!({"cursor":1}))
            .starts_with("HTTP/1.1 200")
    );
    let answered = browser.wait_state("answered");
    assert_eq!(
        answered["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|event| event["action"] == "reply")
            .count(),
        1
    );
    assert_eq!(answered["finding_review"]["read_only"], true);
    assert_eq!(
        fs::read(trial.temporary.path().join("repo/source.txt")).unwrap(),
        b"after\n"
    );
}

struct Browser<'a> {
    trial: &'a Trial,
    helper: std::path::PathBuf,
    state: std::path::PathBuf,
    html: String,
}
impl<'a> Browser<'a> {
    fn new(trial: &'a Trial, html: &str) -> Self {
        let helper = trial
            .root
            .join("tools/artifact-review/target/release/review-artifact");
        fs::copy(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../artifact-review/target/release/review-artifact"),
            &helper,
        )
        .expect("Build artifact-review release first");
        Self {
            trial,
            helper,
            state: trial.temporary.path().join("review-state"),
            html: html.into(),
        }
    }
    fn command(&self, args: &[&str]) -> std::process::Output {
        let configured = self.trial.command();
        let mut command = std::process::Command::new(&self.helper);
        for (key, value) in configured.get_envs() {
            if let Some(value) = value {
                command.env(key, value);
            }
        }
        command
            .env("AR_ROOT", &self.state)
            .env_remove("CLAUDECODE")
            .env_remove("AI_REVIEW_AGENT_LAUNCHED")
            .args(args)
            .output()
            .unwrap()
    }
    fn poll(&self) -> Value {
        let output = self.command(&["poll", &self.html, "--timeout", "0"]);
        success(output.clone());
        serde_json::from_slice(&output.stdout).unwrap()
    }
    fn wait_state(&self, state: &str) -> Value {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let page = self.poll();
            if page["processing"]["state"] == state {
                return page;
            }
            assert!(
                std::time::Instant::now() < deadline,
                "Expected response state {state}, got {}",
                page["processing"]["state"]
            );
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
    fn submit(&self, payload: &Value) -> String {
        self.request("/submit", payload)
    }
    fn request(&self, route: &str, payload: &Value) -> String {
        use std::io::{Read, Write};
        let descriptor = fs::read_dir(&self.state)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.path().join("server.json"))
            .find(|path| path.is_file())
            .unwrap();
        let descriptor: Value = serde_json::from_slice(&fs::read(descriptor).unwrap()).unwrap();
        let host = format!("127.0.0.1:{}", descriptor["port"]);
        let body = payload.to_string();
        let mut connection = std::net::TcpStream::connect(&host).unwrap();
        connection
            .set_read_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        connection
            .set_write_timeout(Some(std::time::Duration::from_secs(5)))
            .unwrap();
        write!(connection, "POST {route} HTTP/1.1\r\nHost: {host}\r\nOrigin: http://{host}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", descriptor["capability"].as_str().unwrap(), body.len()).unwrap();
        let mut response = String::new();
        connection
            .take(131072)
            .read_to_string(&mut response)
            .unwrap();
        response
    }
}
impl Drop for Browser<'_> {
    fn drop(&mut self) {
        if !self.html.is_empty() {
            self.command(&["stop", &self.html]);
        }
    }
}

const RESPONDER: &str = r#"#!/usr/bin/env python3
import os, json
root = os.environ['PI_REVIEW_ROOT']
assert os.path.isfile(os.path.join(root, 'review.json'))
feedback = json.load(open(os.path.join(root, 'feedback.json')))
assert feedback['message'] == 'Explain finding F1'
if feedback.get('id') == 'standalone-context-0002':
    assert any(event.get('action') == 'reply' for event in feedback.get('prior_events', []))
print(json.dumps({'type':'entry_appended','entry':{'customType':'review-scope-ready','data':{'root':root,'tools':['read']}}}))
for name in ['scope.json','patch.diff','review.json','feedback.json']:
    print(json.dumps({'type':'tool_execution_start','toolCallId':name,'toolName':'read','args':{'path':name}}))
    print(json.dumps({'type':'tool_execution_end','toolCallId':name,'toolName':'read','isError':False}))
answer = {'reply':'The frozen evidence supports this explanation. No source changes were made.', 'revision':None}
print(json.dumps({'type':'message_end','message':{'role':'assistant','stopReason':'stop','content':[{'type':'text','text':json.dumps(answer)}]}}))
print(json.dumps({'type':'agent_settled'}))
"#;
