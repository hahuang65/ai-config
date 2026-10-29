use crate::support;
use serde_json::Value;
use std::fs;
use std::os::unix::{fs::PermissionsExt, process::CommandExt};
use std::process::Stdio;
use std::time::{Duration, Instant};
use support::{change::*, *};

fn request(trial: &Trial) -> std::process::Command {
    let mut request = command(trial);
    request
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "Inspect change", "--json"]);
    request
}

#[test]
fn failed_review_retains_private_metadata_but_no_success_report_or_raw_provider_text() {
    let trial = fixture();
    let model = MODEL.replace(
        "'stopReason':'stop'",
        "'stopReason':'error','errorMessage':'PRIVATE_TEST_SECRET'",
    ) + "\nimport sys\nprint('PRIVATE_TEST_SECRET', file=sys.stderr)\n";
    executable(trial.fake_bin.join("pi"), &model);
    let output = review(&trial, &["range", "HEAD~1..HEAD"]);
    let diagnostic = retained(output);
    assert_eq!(diagnostic["category"], "model_api_error");
    assert_eq!(diagnostic["stop_reason"], "error");
    assert_eq!(diagnostic["process"]["exit_code"], 0);
    assert_eq!(
        diagnostic["process"]["stderr_bytes"],
        "PRIVATE_TEST_SECRET\n".len()
    );
}

fn retained(output: std::process::Output) -> Value {
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    let stderr = String::from_utf8(output.stderr).unwrap();
    let path = stderr
        .lines()
        .find_map(|line| line.strip_prefix("Failure diagnostic: "))
        .expect("a failed reviewer should advertise its retained safe diagnostic");
    let path = std::path::Path::new(path);
    assert_eq!(
        fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let directory = path.parent().unwrap();
    assert_eq!(
        fs::metadata(directory).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert!(directory.join("snapshot/scope.json").is_file());
    for name in ["report.json", "report.html", "report.mac"] {
        assert!(!directory.join(name).exists());
    }
    let bytes = fs::read(path).unwrap();
    assert!(bytes.len() < 4096);
    assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE_TEST_SECRET"));
    assert!(!stderr.contains("PRIVATE_TEST_SECRET"));
    let diagnostic: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(diagnostic["version"], 1);
    assert_eq!(diagnostic["engine"], "pi");
    diagnostic
}

#[test]
fn malformed_stream_unknown_reason_and_failed_process_have_safe_retained_categories() {
    let trial = fixture();
    for (model, category) in [
        ("#!/usr/bin/env python3\nprint('PRIVATE_TEST_SECRET')\n".to_owned(), "invalid_completion"),
        (MODEL.replace("'stopReason':'stop'", "'stopReason':'PRIVATE_TEST_SECRET'"), "unknown_stop_reason"),
        ("#!/usr/bin/env python3\nimport sys\nprint('PRIVATE_TEST_SECRET', file=sys.stderr)\nsys.exit(7)\n".to_owned(), "process_exit"),
    ] {
        executable(trial.fake_bin.join("pi"), &model);
        let diagnostic = retained(review(&trial, &["range", "HEAD~1..HEAD"]));
        assert_eq!(diagnostic["category"], category);
        assert!(diagnostic["stop_reason"].is_null());
    }
}

#[test]
fn missing_required_reads_retain_completion_failure_and_process_metadata() {
    let trial = fixture();
    executable(
        trial.fake_bin.join("pi"),
        &(MODEL.to_owned() + "\nimport sys\nprint('PRIVATE_TEST_SECRET', file=sys.stderr)\n"),
    );
    let output = request(&trial)
        .env("CHANGE_TEST_MODE", "no-evidence")
        .output()
        .unwrap();
    let diagnostic = retained(output);
    assert_eq!(diagnostic["category"], "invalid_completion");
    assert_eq!(diagnostic["process"]["exit_code"], 0);
    assert!(diagnostic["process"]["stdout_bytes"].as_u64().unwrap() > 0);
    assert_eq!(
        diagnostic["process"]["stderr_bytes"],
        "PRIVATE_TEST_SECRET\n".len()
    );
}

#[test]
fn each_required_read_is_checked() {
    let trial = fixture();
    for names in ["['scope.json']", "['patch.diff']"] {
        executable(
            trial.fake_bin.join("pi"),
            &MODEL.replace("['scope.json', 'patch.diff']", names),
        );
        let diagnostic = retained(request(&trial).output().unwrap());
        assert_eq!(diagnostic["category"], "invalid_completion");
        assert_eq!(diagnostic["process"]["exit_code"], 0);
    }
}

#[test]
fn findings_schema_errors_retain_only_the_answer_shape() {
    let trial = fixture();
    executable(trial.fake_bin.join("pi"), MODEL);
    for (mode, fences, outside, found, valid, missing, extra) in [
        ("malformed", 0, true, false, false, vec![], 0),
        ("two-fenced", 4, true, true, false, vec![], 0),
        ("destination", 0, false, true, true, vec![], 1),
        ("missing-risk", 0, false, true, true, vec!["risk"], 0),
        (
            "prose-fenced-missing-risk",
            2,
            true,
            true,
            true,
            vec!["risk"],
            0,
        ),
    ] {
        let output = request(&trial)
            .env("CHANGE_TEST_MODE", mode)
            .output()
            .unwrap();
        let diagnostic = retained(output);
        assert_eq!(diagnostic["category"], "invalid_answer", "{mode}");
        let shape = &diagnostic["answer"];
        assert!(shape["response_bytes"].as_u64().unwrap() > 0, "{mode}");
        assert_eq!(shape["fence_lines"], fences, "{mode}");
        assert_eq!(shape["text_outside_json"], outside, "{mode}");
        assert_eq!(shape["json_object_found"], found, "{mode}");
        assert_eq!(shape["json_object_valid"], valid, "{mode}");
        assert_eq!(
            shape["missing_fields"],
            serde_json::json!(missing),
            "{mode}"
        );
        assert_eq!(shape["extra_field_count"], extra, "{mode}");
    }
}

#[test]
fn rejected_answers_record_which_check_failed_without_the_failing_text() {
    let trial = fixture();
    executable(trial.fake_bin.join("pi"), MODEL);
    for (mode, stage) in [
        ("malformed", "parse"),
        ("two-fenced", "parse"),
        ("destination", "schema"),
        ("missing-risk", "schema"),
        ("prose-fenced-missing-risk", "schema"),
        ("control", "content"),
        ("unsafe-path", "content"),
        ("body-only", "content"),
    ] {
        let output = request(&trial)
            .env("CHANGE_TEST_MODE", mode)
            .output()
            .unwrap();
        let diagnostic = retained(output);
        assert_eq!(diagnostic["category"], "invalid_answer", "{mode}");
        assert_eq!(diagnostic["answer"]["stage"], stage, "{mode}");
        assert_eq!(diagnostic["process"]["exit_code"], 0, "{mode}");
        assert!(
            diagnostic["process"]["stdout_bytes"].as_u64().unwrap() > 0,
            "{mode}"
        );
        assert_eq!(diagnostic["process"]["stderr_bytes"], 0, "{mode}");
        let text = diagnostic.to_string();
        for private in ["../outside", "elsewhere/repo", "repository"] {
            assert!(!text.contains(private), "{mode}: {private}");
        }
    }
}

#[test]
fn overflow_retains_other_stream_counts_without_reading_past_the_limit() {
    let trial = fixture();
    executable(
        trial.fake_bin.join("pi"),
        r#"#!/usr/bin/env python3
import os, time
os.write(1, b'PRIVATE_TEST_SECRET' * 8192)
os.close(1)
os.write(2, b'PRIVATE_TEST_SECRET' * 4096)
time.sleep(30)
"#,
    );
    let diagnostic = retained(request(&trial).args(["--timeout", "3"]).output().unwrap());
    assert_eq!(diagnostic["category"], "stderr_limit");
    let count = diagnostic["process"]["stdout_bytes"].as_u64().unwrap();
    assert!(count > 0 && count <= 19 * 8192);
    assert_eq!(diagnostic["process"]["stderr_bytes"], 65537);
}

#[test]
fn interruption_retains_observed_counts_without_inventing_an_exit_status() {
    let trial = fixture();
    let marker = trial.temporary.path().join("reviewer-ready");
    executable(trial.fake_bin.join("pi"), INTERRUPTED);
    let mut child = request(&trial)
        .env("REVIEW_READY", &marker)
        .args(["--timeout", "3"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while !marker.exists() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(10));
    }
    if !marker.exists() {
        let _ = child.kill();
        let _ = child.wait();
        panic!("reviewer did not start");
    }
    unsafe {
        libc::kill(child.id() as i32, libc::SIGINT);
    }
    let diagnostic = retained(child.wait_with_output().unwrap());
    assert_eq!(diagnostic["category"], "process_interrupted");
    for field in ["stdout_bytes", "stderr_bytes"] {
        assert!(
            diagnostic["process"][field]
                .as_u64()
                .is_some_and(|count| count <= 19)
        );
    }
    assert!(diagnostic["process"]["exit_code"].is_null());
    assert!(diagnostic["process"]["signal"].is_null());
}

fn timeout_request(trial: &Trial, mode: &str) -> std::process::Command {
    prepare_timeout_provider(trial);
    let mut command = request(trial);
    command
        .env("EVALUATION_TIMEOUT_FIXTURE_MODE", mode)
        .args(["--timeout", "1"]);
    command
}

fn prepare_timeout_provider(trial: &Trial) {
    let next = trial.fake_bin.join("timeout-provider.next");
    fs::copy(&trial.binary, &next).unwrap();
    fs::rename(next, trial.fake_bin.join("pi")).unwrap();
    let stdout = trial.temporary.path().join("warmup.stdout");
    let stderr = trial.temporary.path().join("warmup.stderr");
    let mut child = std::process::Command::new(trial.fake_bin.join("pi"))
        .env("EVALUATION_TIMEOUT_FIXTURE_MODE", "warmup")
        .stdin(Stdio::null())
        .stdout(fs::File::create(&stdout).unwrap())
        .stderr(fs::File::create(&stderr).unwrap())
        .process_group(0)
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    let status = loop {
        if let Some(status) = child.try_wait().unwrap() {
            break status;
        }
        if Instant::now() >= deadline {
            // SAFETY: this unreaped child owns the fixture preparation process group.
            unsafe {
                libc::kill(-(child.id() as i32), libc::SIGKILL);
            }
            child.wait().unwrap();
            panic!("Native timeout fixture did not prepare within five seconds");
        }
        std::thread::sleep(Duration::from_millis(5));
    };
    assert!(
        status.success(),
        "Rebuild reviewer-fixture before running timeout diagnostic cases"
    );
    assert_eq!(fs::metadata(stdout).unwrap().len(), 0);
    assert_eq!(fs::metadata(stderr).unwrap().len(), 0);
}

#[test]
fn timeout_preserves_an_exited_leaders_status_while_descendants_hold_pipes() {
    let trial = fixture();
    for mode in ["exit", "signal"] {
        let output = timeout_request(&trial, mode).output().unwrap();
        let diagnostic = retained(output);
        assert_eq!(diagnostic["category"], "process_timeout");
        if mode == "exit" {
            assert_eq!(diagnostic["process"]["exit_code"], 7);
            assert!(diagnostic["process"]["signal"].is_null());
        } else {
            assert_eq!(diagnostic["process"]["signal"], libc::SIGTERM);
            assert!(diagnostic["process"]["exit_code"].is_null());
        }
        for field in ["stdout_bytes", "stderr_bytes"] {
            assert_eq!(diagnostic["process"][field], 19);
        }
    }
}

const INTERRUPTED: &str = r#"#!/usr/bin/env python3
import os, time
os.write(1, b'PRIVATE_TEST_SECRET')
os.write(2, b'PRIVATE_TEST_SECRET')
os.close(1)
os.close(2)
open(os.environ['REVIEW_READY'], 'w').close()
time.sleep(30)
"#;

#[test]
fn one_second_deadline_still_covers_delayed_provider_startup() {
    let trial = fixture();
    let output = timeout_request(&trial, "startup-delay").output().unwrap();
    let diagnostic = retained(output);
    assert_eq!(diagnostic["category"], "process_timeout");
    assert_eq!(diagnostic["process"]["stdout_bytes"], 0);
    assert_eq!(diagnostic["process"]["stderr_bytes"], 0);
    assert!(diagnostic["process"]["exit_code"].is_null());
    assert!(diagnostic["process"]["signal"].is_null());
}

#[test]
fn native_timeout_provider_has_a_silent_preparation_mode() {
    let trial = fixture();
    prepare_timeout_provider(&trial);
}

#[test]
fn timeout_diagnostic_fixtures_do_not_depend_on_python_startup() {
    let trial = fixture();
    let marker = trial.temporary.path().join("python-started");
    executable(
        trial.fake_bin.join("python3"),
        "#!/bin/sh\nprintf invoked > \"$TIMEOUT_PYTHON_MARKER\"\nsleep 2\nexit 91\n",
    );
    let output = timeout_request(&trial, "wait")
        .env("TIMEOUT_PYTHON_MARKER", &marker)
        .output()
        .unwrap();
    let diagnostic = retained(output);
    assert!(
        !marker.exists(),
        "A one-second timeout fixture still starts Python"
    );
    assert_eq!(diagnostic["category"], "process_timeout");
    assert_eq!(diagnostic["process"]["stdout_bytes"], 19);
    assert_eq!(diagnostic["process"]["stderr_bytes"], 19);
}

#[test]
fn timed_out_review_retains_failure_without_inventing_an_exit_status() {
    let trial = fixture();
    let output = timeout_request(&trial, "wait").output().unwrap();
    let diagnostic = retained(output);
    assert_eq!(diagnostic["category"], "process_timeout");
    assert_eq!(
        diagnostic["process"]["stdout_bytes"],
        "PRIVATE_TEST_SECRET".len()
    );
    assert_eq!(
        diagnostic["process"]["stderr_bytes"],
        "PRIVATE_TEST_SECRET".len()
    );
    assert!(diagnostic["process"]["exit_code"].is_null());
    assert!(diagnostic["process"]["signal"].is_null());
}
