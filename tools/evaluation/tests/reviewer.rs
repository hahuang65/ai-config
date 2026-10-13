mod support;
use serde_json::{Value, json};
use std::fs;
use std::process::Command;
use std::time::{Duration, Instant};
use support::*;

fn prepared() -> Trial {
    let trial = Trial::new();
    trial.install();
    put(
        trial.root.join("harnesses/pi/review-scope.ts"),
        "scope fixture\n",
    );
    put(trial.root.join("reviewer.md"), "review instructions\n");
    put(
        trial.temporary.path().join("snapshot/source.txt"),
        "source\n",
    );
    executable(trial.fake_bin.join("pi"), REVIEWER);
    trial
}

fn request(trial: &Trial) -> Command {
    let mut command = trial.command();
    command
        .args(["reviewer", "--snapshot"])
        .arg(fs::canonicalize(trial.temporary.path().join("snapshot")).unwrap())
        .args(["--prompt", "Inspect source.txt"]);
    command
}

#[test]
fn claude_engine_does_not_start_pi_or_require_its_isolated_profile() {
    let trial = Trial::new();
    put(
        trial.temporary.path().join("snapshot/source.txt"),
        "source\n",
    );
    let claude_marker = trial.temporary.path().join("claude-started");
    executable(
        trial.fake_bin.join("claude"),
        "#!/bin/sh\nprintf started > \"$CLAUDE_MARKER\"\nexit 7\n",
    );
    let output = request(&trial)
        .args(["--engine", "claude"])
        .env("CLAUDE_MARKER", &claude_marker)
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(claude_marker.exists());
    assert!(!trial.log.exists());
    assert!(!trial.profile().exists());
    assert!(output.stdout.is_empty());
}

#[test]
fn rejects_unknown_engine_and_pi_only_options_before_launch() {
    let trial = Trial::new();
    put(
        trial.temporary.path().join("snapshot/source.txt"),
        "source\n",
    );
    for arguments in [
        &["--engine", "other"][..],
        &["--engine", "claude", "--provider", "fixture"],
        &["--engine", "claude", "--thinking", "high"],
    ] {
        let output = request(&trial).args(arguments).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
    }
    assert!(!trial.log.exists());
    assert!(!trial.profile().exists());
}

#[test]
fn reviewer_option_pairs_keep_specific_errors_without_starting_a_runner() {
    let trial = Trial::new();
    put(
        trial.temporary.path().join("snapshot/source.txt"),
        "source\n",
    );
    for (options, message) in [
        (&["--timeout"][..], "Reviewer options need values"),
        (&["--unknown", "value"], "Unsupported reviewer option"),
        (
            &["--prompt", "duplicate"],
            "Duplicate reviewer option: --prompt",
        ),
    ] {
        let output = request(&trial).args(options).output().unwrap();
        assert_eq!(output.status.code(), Some(2));
        assert!(String::from_utf8_lossy(&output.stderr).contains(message));
        assert!(output.stdout.is_empty());
    }
    assert!(!trial.log.exists());
    assert!(!trial.profile().exists());
}

#[test]
fn returns_only_completed_reviewer_text_with_scoped_read_evidence() {
    let trial = prepared();
    let snapshot = fs::canonicalize(trial.temporary.path().join("snapshot")).unwrap();
    let path = format!(
        ".:{}:{}:{}",
        snapshot.display(),
        trial.fake_bin.display(),
        std::env::var("PATH").unwrap()
    );
    let output = request(&trial)
        .env("PATH", path)
        .env("NODE_OPTIONS", "--require ./poison.cjs")
        .env("NODE_PATH", &snapshot)
        .env("GIT_DIR", &snapshot)
        .output()
        .unwrap();
    success(output.clone());
    let result: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(result["protocolVersion"], 1);
    assert_eq!(result["response"], "Reviewed π\u{2028}text\n");
    assert_eq!(result["filesRead"], json!(["source.txt"]));
    let calls = trial.calls();
    let call = calls.last().unwrap();
    assert_eq!(call["cwd"], json!(trial.root));
    assert_eq!(call["snapshot"], result["snapshot"]);
    assert_eq!(call["nodeOptions"], Value::Null);
    assert_eq!(call["nodePath"], Value::Null);
    assert_eq!(call["gitDir"], Value::Null);
    assert!(call["path"].as_array().unwrap().iter().all(|path| {
        path.as_str().is_some_and(|path| {
            std::path::Path::new(path).is_absolute()
                && !std::path::Path::new(path).starts_with(&snapshot)
        })
    }));
    let agent_dir = std::path::Path::new(call["agentDir"].as_str().unwrap());
    assert!(agent_dir.is_absolute());
    assert!(!agent_dir.exists(), "the restricted profile is ephemeral");
    assert_resources(call, &trial);
    assert!(!trial.profile().join("sessions").exists());
}

fn assert_resources(call: &Value, trial: &Trial) {
    let args = call["args"].as_array().unwrap();
    for flag in [
        "--no-context-files",
        "--no-approve",
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-themes",
        "--no-builtin-tools",
        "--no-session",
        "--offline",
    ] {
        assert!(args.contains(&json!(flag)), "missing {flag}");
    }
    assert!(!args.contains(&json!("--tools")));
    assert!(!args.contains(&json!("--skill")));
    assert!(!args.contains(&json!(trial.root.join("extensions/wt.ts"))));
    assert!(args.contains(&json!(trial.root.join("harnesses/pi/review-scope.ts"))));
}

#[test]
fn literal_prompt_and_model_options_cannot_inject_resources() {
    let trial = prepared();
    let output = trial
        .command()
        .args(["reviewer", "--snapshot"])
        .arg(trial.temporary.path().join("snapshot"))
        .args([
            "--prompt",
            "@private-file\n--approve /login",
            "--provider",
            "fixture",
            "--model",
            "test",
            "--thinking",
            "off",
        ])
        .output()
        .unwrap();
    success(output);
    let calls = trial.calls();
    let args = calls.last().unwrap()["args"].as_array().unwrap();
    assert_eq!(args[args.len() - 2], "--");
    assert!(
        args.last()
            .unwrap()
            .as_str()
            .unwrap()
            .ends_with("@private-file\n--approve /login")
    );
    assert!(!args.last().unwrap().as_str().unwrap().starts_with('@'));
    assert!(args.contains(&json!("--provider")));
    assert!(!args.contains(&json!("--approve")));
}

#[test]
fn rejects_invalid_invocations_before_launch_or_profile_creation() {
    let trial = Trial::new();
    for args in INVALID_INVOCATIONS {
        let output = trial.run(args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
    }
    let oversized = "x".repeat(65_537);
    assert_eq!(
        trial
            .run(&["reviewer", "--snapshot", "/tmp", "--prompt", &oversized])
            .status
            .code(),
        Some(2)
    );
    assert!(!trial.log.exists());
    assert!(!trial.profile().exists());
}

#[test]
fn help_needs_no_installation_and_never_starts_pi() {
    let trial = Trial::new();
    let output = trial.run(&["reviewer", "--help"]);
    success(output.clone());
    assert!(String::from_utf8_lossy(&output.stdout).contains("--snapshot"));
    assert!(!trial.log.exists());
    assert!(!trial.profile().exists());
}

#[test]
fn refuses_missing_scope_assets_and_snapshots_containing_profile_state() {
    let trial = prepared();
    fs::remove_file(trial.root.join("harnesses/pi/review-scope.ts")).unwrap();
    let before = trial.calls().len();
    assert_eq!(request(&trial).output().unwrap().status.code(), Some(1));
    assert_eq!(trial.calls().len(), before);
    put(
        trial.root.join("harnesses/pi/review-scope.ts"),
        "scope fixture",
    );
    assert_eq!(
        trial
            .command()
            .args(["reviewer", "--snapshot"])
            .arg(&trial.root)
            .args(["--prompt", "review"])
            .output()
            .unwrap()
            .status
            .code(),
        Some(1)
    );
    assert_eq!(trial.calls().len(), before);
}

#[test]
fn refuses_a_snapshot_nested_inside_the_isolated_profile() {
    let trial = prepared();
    let snapshot = trial.profile().join("sessions");
    put(snapshot.join("source.txt"), "private session fixture");
    let before = trial.calls().len();
    let output = trial
        .command()
        .args(["reviewer", "--snapshot"])
        .arg(snapshot)
        .args(["--prompt", "review"])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert_eq!(trial.calls().len(), before);
}

#[test]
fn incomplete_or_failed_streams_never_return_successful_results_or_raw_diagnostics() {
    let trial = prepared();
    for mode in [
        "no-ready",
        "wrong-root",
        "no-settled",
        "error",
        "length",
        "malformed",
        "nonzero",
        "overflow",
        "outside-read",
        "non-object",
        "unsafe-tool",
        "early-settled",
    ] {
        let output = request(&trial)
            .env("REVIEW_TEST_MODE", mode)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "mode {mode}");
        assert!(output.stdout.is_empty(), "mode {mode}");
        assert!(!String::from_utf8_lossy(&output.stderr).contains("fixture-private-diagnostic"));
    }
}

#[test]
fn deadline_covers_descendants_that_hold_output_pipes_after_pi_exits() {
    let trial = prepared();
    let start = Instant::now();
    let output = request(&trial)
        .args(["--timeout", "1"])
        .env("REVIEW_TEST_MODE", "inherited-pipe")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(start.elapsed() < Duration::from_secs(4));
}

#[test]
fn interruption_stops_the_reviewer_without_returning_a_partial_result() {
    let trial = prepared();
    assert!(!trial.log.exists());
    let child = request(&trial)
        .env("REVIEW_TEST_MODE", "wait")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    let started = Instant::now();
    while !trial.log.exists() && started.elapsed() < Duration::from_secs(3) {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(trial.log.exists(), "fixture process did not start");
    unsafe {
        libc::kill(child.id() as i32, libc::SIGINT);
    }
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(started.elapsed() < Duration::from_secs(4));
}

const INVALID_INVOCATIONS: &[&[&str]] = &[
    &["reviewer"],
    &["reviewer", "--snapshot", "/tmp"],
    &["reviewer", "--snapshot", "relative", "--prompt", "review"],
    &["reviewer", "--snapshot", "/", "--prompt", "review"],
    &["reviewer", "--snapshot", "/tmp", "--prompt", ""],
    &[
        "reviewer",
        "--snapshot",
        "/tmp",
        "--prompt",
        "review",
        "--tools",
        "bash",
    ],
    &[
        "reviewer",
        "--snapshot",
        "/tmp",
        "--prompt",
        "review",
        "--extension",
        "foreign.ts",
    ],
    &[
        "reviewer",
        "--snapshot",
        "/tmp",
        "--prompt",
        "review",
        "--model",
        "x",
        "--model",
        "y",
    ],
    &[
        "reviewer",
        "--snapshot",
        "/tmp",
        "--prompt",
        "review",
        "--timeout",
        "0",
    ],
    &[
        "reviewer",
        "--snapshot",
        "/tmp",
        "--prompt",
        "review",
        "--thinking",
        "invented",
    ],
    &["reviewer", "--help", "--approve"],
];

const REVIEWER: &str = r#"#!/usr/bin/env python3
import json, os, subprocess, sys
root = os.environ.get('PI_REVIEW_ROOT', os.getcwd())
with open(os.environ['EVALUATION_TEST_LOG'], 'a') as log:
    log.write(json.dumps({'args': sys.argv[1:], 'cwd': os.getcwd(), 'snapshot': root, 'agentDir': os.environ.get('PI_CODING_AGENT_DIR'), 'nodeOptions': os.environ.get('NODE_OPTIONS'), 'nodePath': os.environ.get('NODE_PATH'), 'gitDir': os.environ.get('GIT_DIR'), 'path': os.environ['PATH'].split(os.pathsep)}) + '\n')
mode = os.environ.get('REVIEW_TEST_MODE', '')
if mode == 'wait':
    import time
    time.sleep(8)
    sys.exit(0)
if mode == 'inherited-pipe':
    subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(8)'])
    sys.exit(0)
if mode == 'malformed':
    print('fixture-private-diagnostic')
    sys.exit(0)
if mode == 'overflow':
    print('x' * (16 * 1024 * 1024 + 1))
    sys.exit(0)
if mode == 'non-object': print('42')
if mode != 'no-ready':
    print(json.dumps({'type': 'entry_appended', 'entry': {'type': 'custom', 'customType': 'review-scope-ready', 'data': {'root': '/' if mode == 'wrong-root' else root, 'tools': ['read']}}}))
print(json.dumps({'type': 'tool_execution_start', 'toolCallId': 'read-1', 'toolName': 'read', 'args': {'path': '/outside' if mode == 'outside-read' else os.path.join(root, 'source.txt')}}))
print(json.dumps({'type': 'tool_execution_end', 'toolCallId': 'read-1', 'toolName': 'write' if mode == 'unsafe-tool' else 'read', 'isError': False}))
if mode == 'early-settled': print(json.dumps({'type': 'agent_settled'}))
print(json.dumps({'type': 'message_end', 'message': {'role': 'assistant', 'stopReason': mode if mode in ('error', 'length') else 'stop', 'content': [{'type': 'text', 'text': 'Reviewed π\u2028text\n'}], 'errorMessage': 'fixture-private-diagnostic'}}))
if mode not in ['no-settled', 'early-settled']: print(json.dumps({'type': 'agent_settled'}))
print('fixture-private-diagnostic', file=sys.stderr)
sys.exit(7 if mode == 'nonzero' else 0)
"#;
