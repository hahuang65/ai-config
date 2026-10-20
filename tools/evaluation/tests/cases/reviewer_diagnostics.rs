use crate::support;
use std::{
    fs,
    process::{Command, Output},
};
use support::*;

fn prepared() -> Trial {
    let trial = Trial::new();
    put(
        trial.root.join("harnesses/pi/review-scope.ts"),
        "scope fixture\n",
    );
    put(trial.root.join("reviewer.md"), "review instructions\n");
    put(
        trial.temporary.path().join("snapshot/source.txt"),
        "source\n",
    );
    executable(trial.fake_bin.join("pi"), MODEL);
    trial
}

fn request(trial: &Trial, mode: &str) -> Command {
    let mut command = trial.command();
    command
        .args(["reviewer", "--snapshot"])
        .arg(fs::canonicalize(trial.temporary.path().join("snapshot")).unwrap())
        .args(["--prompt", "Inspect source.txt"])
        .env("DIAGNOSTIC_TEST_MODE", mode);
    command
}

fn failure(output: Output) -> String {
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    let diagnostic = String::from_utf8(output.stderr).unwrap();
    assert!(!diagnostic.contains("PRIVATE_TEST_SECRET"));
    assert!(!diagnostic.contains("UNTRUSTED_MODEL_TEXT"));
    assert!(diagnostic.len() < 4096);
    diagnostic
}

#[test]
fn successful_process_exit_does_not_hide_a_model_or_api_error() {
    let trial = prepared();
    trial.assert_uninstalled();
    let diagnostic = failure(request(&trial, "error").output().unwrap());
    assert!(diagnostic.contains("model/API error"), "{diagnostic}");
    assert!(diagnostic.contains("stopReason=error"), "{diagnostic}");
    assert!(diagnostic.contains("exit=0"), "{diagnostic}");
    trial.assert_uninstalled();
}

#[test]
fn incomplete_model_outcomes_have_distinct_safe_diagnostics() {
    let trial = prepared();
    for (mode, description) in [
        ("length", "model output limit"),
        ("aborted", "model request aborted"),
        ("toolUse", "unfinished tool work"),
        ("PRIVATE_TEST_SECRET", "unknown or missing stop reason"),
    ] {
        let diagnostic = failure(request(&trial, mode).output().unwrap());
        assert!(diagnostic.contains(description), "{mode}: {diagnostic}");
    }
}

#[test]
fn failed_process_retains_exit_status_and_stderr_size_without_raw_text() {
    let trial = prepared();
    let diagnostic = failure(request(&trial, "exit").output().unwrap());
    assert!(
        diagnostic.contains("process exited unsuccessfully"),
        "{diagnostic}"
    );
    assert!(diagnostic.contains("exit=7"), "{diagnostic}");
    assert!(
        diagnostic.contains(&format!("stderrBytes={}", "PRIVATE_TEST_SECRET\n".len())),
        "{diagnostic}"
    );
}

#[test]
fn runner_limits_are_distinct_from_model_output_limits_and_timeouts() {
    let trial = prepared();
    for (mode, description) in [
        ("stdout-limit", "event stream limit exceeded"),
        ("stderr-limit", "stderr limit exceeded"),
        ("timeout", "timed out"),
    ] {
        // Output-limit probes need startup headroom; only the timeout probe should expire.
        let seconds = if mode == "timeout" { "1" } else { "10" };
        let diagnostic = failure(
            request(&trial, mode)
                .args(["--timeout", seconds])
                .output()
                .unwrap(),
        );
        assert!(diagnostic.contains(description), "{mode}: {diagnostic}");
        assert!(diagnostic.contains("engine=pi"), "{mode}: {diagnostic}");
    }
}

const MODEL: &str = r#"#!/usr/bin/env python3
import json, os, sys
root = os.environ['PI_REVIEW_ROOT']
mode = os.environ['DIAGNOSTIC_TEST_MODE']
if mode == 'stdout-limit':
    sys.stdout.write('PRIVATE_TEST_SECRET' * 1000000)
    sys.stdout.flush()
    sys.exit(0)
if mode == 'stderr-limit':
    sys.stderr.write('PRIVATE_TEST_SECRET' * 10000)
    sys.stderr.flush()
    sys.exit(0)
if mode == 'timeout':
    import time
    time.sleep(30)
print(json.dumps({'type':'entry_appended','entry':{'customType':'review-scope-ready','data':{'root':root,'tools':['read']}}}))
print(json.dumps({'type':'message_end','message':{'role':'assistant','stopReason':mode,'content':[{'type':'text','text':'UNTRUSTED_MODEL_TEXT'}],'errorMessage':'PRIVATE_TEST_SECRET'}}))
print(json.dumps({'type':'agent_settled'}))
print('PRIVATE_TEST_SECRET', file=sys.stderr)
if mode == 'exit': sys.exit(7)
"#;
