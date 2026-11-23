use crate::support::{Trial, change, executable, put, read_json, success};

#[test]
fn jev_finding_checks_are_visible_and_never_drop_or_merge_findings() {
    let trial = change::fixture();
    fake_classifier(&trial);
    let output = change::command(&trial)
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Replace before with after", "--jev", "--json"])
        .env("CHANGE_TEST_MODE", "two")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let report = read_json(receipt["record"].as_str().unwrap());
    assert_eq!(report["findings"].as_array().unwrap().len(), 2);
    assert_eq!(report["findings"][0]["id"], "F1");
    assert_eq!(report["findings"][1]["id"], "F2");
    let checks = report["jev"]["findings"].as_array().unwrap();
    assert_eq!(checks.len(), 2);
    assert_eq!(checks[0]["finding_id"], "F1");
    assert_eq!(checks[0]["supported"], 0.95);
    assert_eq!(checks[0]["introduced"], 0.95);
    assert_eq!(checks[0]["duplicates"][0]["finding_id"], "F2");
    let html = std::fs::read_to_string(receipt["report"].as_str().unwrap()).unwrap();
    assert!(html.contains("Jev advisory"));
    assert!(html.contains("Evidence support"));
}

#[test]
fn finding_wording_changes_invalidate_jev_assessments_without_losing_findings() {
    use sha2::{Digest, Sha256};
    let trial = change::fixture();
    fake_classifier(&trial);
    let output = change::command(&trial)
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Replace before with after", "--jev", "--json"])
        .output()
        .unwrap();
    success(output.clone());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let record = std::path::Path::new(receipt["record"].as_str().unwrap());
    let bytes = std::fs::read(record).unwrap();
    let original = read_json(record);
    let edit = serde_json::from_value(
        serde_json::json!({"summary":null,"findings":[{"id":"F1","title":"Clarified wording"}]}),
    )
    .unwrap();
    evaluation::report_edit::apply(
        std::path::Path::new(receipt["report"].as_str().unwrap()),
        &format!("{:x}", Sha256::digest(&bytes)),
        original["html_digest"].as_str().unwrap(),
        &edit,
    )
    .unwrap();
    let updated = read_json(record);
    assert_eq!(updated["findings"].as_array().unwrap().len(), 1);
    assert_eq!(updated["findings"][0]["title"], "Clarified wording");
    assert_eq!(updated["jev"]["status"], "stale");
    assert_eq!(updated["jev"]["findings"][0]["status"], "stale");
    assert!(updated["jev"]["findings"][0]["supported"].is_null());
    assert_eq!(updated["digest"], original["digest"]);
}

#[test]
fn context_sampling_is_bounded_without_removing_eligible_snapshot_evidence() {
    let trial = change::fixture();
    fake_classifier(&trial);
    let repo = trial.temporary.path().join("repo");
    let terms = (0..64)
        .map(|n| format!("alpha{n}"))
        .collect::<Vec<_>>()
        .join(" ");
    for index in 0..64 {
        put(
            repo.join(format!("a-context-{index:02}.txt")),
            "alpha0 ".repeat(2400),
        );
    }
    put(repo.join("z-helper.txt"), &terms);
    change::git(&trial, &["add", "."]);
    change::git(&trial, &["commit", "-m", "context"]);
    put(repo.join("source.txt"), &terms);
    let output = change::command(&trial)
        .args(["review", "local", "--repo"])
        .arg(&repo)
        .args(["--intent", "Change source validation", "--jev", "--json"])
        .output()
        .unwrap();
    success(output.clone());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let report = read_json(receipt["record"].as_str().unwrap());
    assert!(
        !report["jev"]["context"]
            .as_array()
            .unwrap()
            .iter()
            .any(|item| item["path"] == "z-helper.txt")
    );
    let scope =
        read_json(std::path::Path::new(receipt["snapshot"].as_str().unwrap()).join("scope.json"));
    assert!(
        scope["after"]
            .as_array()
            .unwrap()
            .iter()
            .any(|path| path == "z-helper.txt")
    );
    assert_eq!(report["findings"].as_array().unwrap().len(), 1);
}

#[test]
fn default_review_never_calls_jev_or_creates_assistance_fields() {
    let trial = change::fixture();
    fake_classifier(&trial);
    let log = trial.temporary.path().join("jev-calls.jsonl");
    let output = change::command(&trial)
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Replace before with after", "--json"])
        .env("JEV_FIXTURE_CALL_LOG", &log)
        .output()
        .unwrap();
    success(output.clone());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let report = read_json(receipt["record"].as_str().unwrap());
    assert!(!report.as_object().unwrap().contains_key("jev"));
    assert!(!log.exists());
}

#[test]
fn low_scores_do_not_skip_review_or_change_any_finding() {
    let trial = change::fixture();
    fake_classifier(&trial);
    let run = |jev: bool| {
        let mut command = change::command(&trial);
        command
            .args(["review", "range", "HEAD~1..HEAD", "--repo"])
            .arg(trial.temporary.path().join("repo"))
            .args(["--intent", "Replace before with after", "--json"])
            .env("CHANGE_TEST_MODE", "two")
            .env("JEV_FIXTURE_PROBABILITY", "0.01");
        if jev {
            command.arg("--jev");
        }
        let output = command.output().unwrap();
        success(output.clone());
        let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
        read_json(receipt["record"].as_str().unwrap())
    };
    let baseline = run(false);
    let assisted = run(true);
    assert_eq!(assisted["findings"], baseline["findings"]);
    assert_eq!(assisted["files_read"], baseline["files_read"]);
    assert_eq!(assisted["jev"]["findings"][0]["supported"], 0.01);
    assert_eq!(assisted["jev"]["checklist"][0]["probability"], 0.01);
}

#[test]
fn malformed_finding_assessment_is_partial_without_losing_original_findings() {
    let trial = change::fixture();
    fake_classifier(&trial);
    let output = change::command(&trial)
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Replace before with after", "--jev", "--json"])
        .env("CHANGE_TEST_MODE", "two")
        .env("JEV_FIXTURE_INVALID_FINDINGS", "1")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let report = read_json(receipt["record"].as_str().unwrap());
    assert_eq!(report["jev"]["status"], "partial");
    assert_eq!(report["jev"]["calls"].as_array().unwrap().len(), 1);
    assert_eq!(report["findings"].as_array().unwrap().len(), 2);
    assert_eq!(report["findings"][0]["severity"], "medium");
    for check in report["jev"]["findings"].as_array().unwrap() {
        assert_eq!(check["status"], "unavailable");
        assert!(check["supported"].is_null());
    }
}

#[test]
fn interrupting_jev_planning_stops_before_starting_the_reviewer() {
    interrupted_assistance("planning", libc::SIGINT);
}

#[test]
fn interrupting_jev_findings_stops_before_saving_a_report() {
    interrupted_assistance("findings", libc::SIGINT);
}

#[test]
fn terminating_jev_planning_stops_before_starting_the_reviewer() {
    interrupted_assistance("planning", libc::SIGTERM);
}

#[test]
fn terminating_jev_findings_stops_before_saving_a_report() {
    interrupted_assistance("findings", libc::SIGTERM);
}

fn interrupted_assistance(phase: &str, signal: i32) {
    use std::time::{Duration, Instant};
    let trial = change::fixture();
    let ready = trial.home.join("jev-ready");
    let reviewer = trial.home.join("reviewer-ready");
    let state = trial.home.join("interrupted-state");
    let mut child = paused_review(&trial, phase);
    let deadline = Instant::now() + Duration::from_secs(3);
    while !ready.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    if !ready.exists() {
        let _ = child.kill();
        let _ = child.wait();
        panic!("Jev fixture did not reach {phase}");
    }
    assert_eq!(unsafe { libc::kill(child.id() as i32, signal) }, 0);
    let output = child.wait_with_output().unwrap();
    assert!(
        !output.status.success(),
        "interruption continued successfully: {}",
        String::from_utf8_lossy(&output.stdout)
    );
    assert!(String::from_utf8_lossy(&output.stderr).contains("interrupted"));
    assert!(output.stdout.is_empty());
    assert_eq!(reviewer.exists(), phase == "findings");
    for entry in std::fs::read_dir(&state).unwrap().flatten() {
        assert!(!entry.path().join("report.json").exists());
    }
}

fn paused_review(trial: &Trial, phase: &str) -> std::process::Child {
    use std::process::Stdio;
    fake_classifier(trial);
    executable(
        trial.fake_bin.join("pi"),
        &change::MODEL.replacen(
            "import os, json",
            "import os, json\nopen(os.environ['JEV_FIXTURE_REVIEWER_READY'], 'w').write('started')",
            1,
        ),
    );
    change::command(trial)
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args([
            "--intent",
            "Replace before with after",
            "--jev",
            "--json",
            "--state-dir",
        ])
        .arg(trial.home.join("interrupted-state"))
        .env("JEV_FIXTURE_PAUSE_PHASE", phase)
        .env("JEV_FIXTURE_READY", trial.home.join("jev-ready"))
        .env(
            "JEV_FIXTURE_REVIEWER_READY",
            trial.home.join("reviewer-ready"),
        )
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

fn fake_classifier(trial: &Trial) {
    put(
        trial.root.join("harnesses/pi/jev-bridge.mjs"),
        "trusted fixture bridge\n",
    );
    executable(
        trial.fake_bin.join("node"),
        r#"#!/usr/bin/env python3
import json, sys, os, time
request = json.load(open(sys.argv[-1]))
phase = 'findings' if 'claims' in request['state'] else 'planning'
if phase == os.environ.get('JEV_FIXTURE_PAUSE_PHASE'):
 open(os.environ['JEV_FIXTURE_READY'], 'w').write('ready')
 time.sleep(4)
if os.environ.get('JEV_FIXTURE_CALL_LOG'):
 with open(os.environ['JEV_FIXTURE_CALL_LOG'], 'a') as log: log.write(json.dumps(request) + '\n')
probability = float(os.environ.get('JEV_FIXTURE_PROBABILITY','0.95'))
if 'claims' in request['state'] and os.environ.get('JEV_FIXTURE_INVALID_FINDINGS'): probability = -1
print(json.dumps({'status':'ok','model':'jev-1.14.0','probabilities':{key:probability for key in request['questions']},'inputTokens':100,'outputTokens':0,'elapsedMs':1}))
"#,
    );
}

#[test]
fn opted_in_jev_unavailability_preserves_the_full_review_and_findings() {
    let trial = change::fixture();
    let output = change::command(&trial)
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Replace before with after", "--jev", "--json"])
        .env_remove("TYPESAFE_API_KEY")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let report = read_json(receipt["record"].as_str().unwrap());
    assert_eq!(report["findings"].as_array().unwrap().len(), 1);
    assert_eq!(report["jev"]["status"], "unavailable");
    let reads = report["files_read"].as_array().unwrap();
    assert!(reads.iter().any(|path| path == "scope.json"));
    assert!(reads.iter().any(|path| path == "patch.diff"));
    assert_eq!(receipt["findingCount"], 1);
}

#[test]
fn jev_prioritizes_supplemental_context_and_builds_a_checklist_without_narrowing_review() {
    let trial = change::fixture();
    let repo = trial.temporary.path().join("repo");
    put(
        repo.join("helper.txt"),
        "after validation helper for source behavior\n",
    );
    change::git(&trial, &["add", "helper.txt"]);
    change::git(&trial, &["commit", "-m", "context"]);
    put(repo.join("source.txt"), "after validation changed\n");
    fake_classifier(&trial);
    let output = change::command(&trial)
        .args(["review", "local", "--repo"])
        .arg(&repo)
        .args(["--intent", "Change source validation", "--jev", "--json"])
        .output()
        .unwrap();
    success(output.clone());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let report = read_json(receipt["record"].as_str().unwrap());
    assert_eq!(report["jev"]["status"], "ok");
    assert_eq!(report["jev"]["context"][0]["path"], "helper.txt");
    assert!(report["jev"]["checklist"].as_array().unwrap().len() >= 4);
    assert_eq!(report["findings"].as_array().unwrap().len(), 1);
    let scope =
        read_json(std::path::Path::new(receipt["snapshot"].as_str().unwrap()).join("scope.json"));
    assert!(
        scope["after"]
            .as_array()
            .unwrap()
            .iter()
            .any(|path| path == "source.txt")
    );
    assert!(
        scope["after"]
            .as_array()
            .unwrap()
            .iter()
            .any(|path| path == "helper.txt")
    );
}
