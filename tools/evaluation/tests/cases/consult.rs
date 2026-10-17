use crate::support;
use serde_json::{Value, json};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use support::{change::*, consult::FAKE_PI, *};

fn prepared() -> Trial {
    let trial = fixture();
    executable(trial.fake_bin.join("pi"), FAKE_PI);
    assert!(!trial.log.exists());
    trial
}

fn request(trial: &Trial, agent: &str, prompt: &str) -> Command {
    let mut command = trial.consult_command();
    command
        .arg("--root")
        .arg(&trial.root)
        .args(["--agent", agent, "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--prompt", prompt]);
    command
}

fn result(command: &mut Command) -> Value {
    let output = command.output().unwrap();
    success(output.clone());
    assert!(output.stderr.is_empty());
    serde_json::from_slice(&output.stdout).unwrap()
}

fn assert_usage_error(command: &mut Command) {
    let output = command.output().unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
}

fn store(trial: &Trial) -> PathBuf {
    trial.home.join(".local/state/ai-config/change-reviews")
}

fn assert_no_consultation(directory: &Path) {
    if !directory.exists() {
        return;
    }
    assert!(fs::read_dir(directory).unwrap().all(|entry| {
        !entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with("consult-")
    }));
}

#[test]
fn standalone_consultation_accepts_a_question_without_a_subcommand() {
    let trial = prepared();
    let advice = result(
        trial
            .consult_command()
            .arg("--root")
            .arg(&trial.root)
            .args(["--agent", "api-designer", "--repo"])
            .arg(trial.temporary.path().join("repo"))
            .args(["--prompt", "Suggest an API"]),
    );
    assert_eq!(advice["agent"], "api-designer");
    assert_eq!(
        advice["response"],
        "Prefer a small interface. No tests executed."
    );
}

#[test]
fn retains_private_advice_and_snapshot_even_without_changes() {
    let trial = prepared();
    let advice = result(&mut request(&trial, "api-designer", "Suggest an API"));
    assert_eq!(advice["protocolVersion"], 1);
    assert_eq!(advice["agent"], "api-designer");
    assert_eq!(
        advice["response"],
        "Prefer a small interface. No tests executed."
    );
    assert_eq!(
        advice["filesRead"],
        json!(["after/source.txt", "scope.json"])
    );
    assert!(advice["limits"].to_string().contains("No tests"));
    let record = Path::new(advice["record"].as_str().unwrap());
    let snapshot = Path::new(advice["snapshot"].as_str().unwrap());
    let directory = record.parent().unwrap();
    assert_eq!(read_json(record), advice);
    assert_eq!(directory.parent(), Some(store(&trial).as_path()));
    assert!(
        directory
            .file_name()
            .unwrap()
            .to_str()
            .unwrap()
            .starts_with("consult-")
    );
    assert_eq!(snapshot, directory.join("snapshot"));
    assert!(fs::read(snapshot.join("patch.diff")).unwrap().is_empty());
    assert_eq!(
        fs::metadata(directory).unwrap().permissions().mode() & 0o777,
        0o700
    );
    assert_eq!(
        fs::metadata(record).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(fs::read_dir(directory).unwrap().count(), 2);
    assert!(!trial.profile().join("auth.json").exists());
    assert_eq!(trial.calls().len(), 1);
}

#[test]
fn loads_each_canonical_role_only_through_the_restricted_native_engine() {
    let trial = prepared();
    for agent in [
        "api-designer",
        "frontend-architect",
        "database-reviewer",
        "fact-checker",
        "change-reviewer",
    ] {
        let advice = result(&mut request(&trial, agent, "Inspect the design"));
        assert_eq!(advice["agent"], agent);
        let calls = trial.calls();
        let call = calls.last().unwrap();
        let args = call["args"].as_array().unwrap();
        let role = json!(trial.root.join(format!("agents/{agent}.md")));
        assert!(
            args.windows(2)
                .any(|pair| pair == [json!("--append-system-prompt"), role.clone()])
        );
        for flag in [
            "--no-builtin-tools",
            "--no-context-files",
            "--no-extensions",
            "--no-skills",
            "--no-session",
            "--offline",
        ] {
            assert!(args.contains(&json!(flag)));
        }
        assert!(args.contains(&json!(trial.root.join("harnesses/pi/review-scope.ts"))));
        assert!(!args.contains(&json!("--tools")));
        assert!(!args.contains(&json!("--skill")));
        assert_eq!(call["cwd"], json!(trial.root));
        let agent_dir = Path::new(call["agentDir"].as_str().unwrap());
        assert!(agent_dir.is_absolute());
        assert!(!agent_dir.exists(), "the restricted profile is ephemeral");
    }
}

#[test]
fn keeps_prompts_literal_and_forwards_only_valid_model_options() {
    let trial = prepared();
    let prompt = "@private-file\n--approve /login $(touch forbidden)";
    result(request(&trial, "fact-checker", prompt).args([
        "--provider",
        "fixture",
        "--model",
        "test",
        "--thinking",
        "off",
        "--timeout",
        "5",
    ]));
    let calls = trial.calls();
    let args = calls.last().unwrap()["args"].as_array().unwrap();
    assert_eq!(args[args.len() - 2], "--");
    assert!(args.last().unwrap().as_str().unwrap().contains(prompt));
    assert!(!args.last().unwrap().as_str().unwrap().starts_with('@'));
    assert!(
        args.windows(2)
            .any(|pair| pair == [json!("--provider"), json!("fixture")])
    );
    assert!(
        args.windows(2)
            .any(|pair| pair == [json!("--model"), json!("test")])
    );
    assert!(!args.contains(&json!("--approve")));
}

#[test]
fn excludes_private_source_and_original_checkout_from_provider_path() {
    let trial = prepared();
    let repo = trial.temporary.path().join("repo").canonicalize().unwrap();
    put(repo.join(".env"), "fixture-private-source");
    executable(repo.join("bin/pi"), "#!/bin/sh\nexit 97\n");
    let path = format!(
        ".:{}:{}:{}",
        repo.join("bin").display(),
        trial.fake_bin.display(),
        std::env::var("PATH").unwrap()
    );
    let advice = result(request(&trial, "database-reviewer", "Inspect tables").env("PATH", path));
    let snapshot = Path::new(advice["snapshot"].as_str().unwrap());
    assert!(!snapshot.join("after/.env").exists());
    assert!(
        read_json(snapshot.join("scope.json"))["excluded"]
            .get(".env")
            .is_some()
    );
    let calls = trial.calls();
    assert!(
        calls.last().unwrap()["path"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| {
                let path = Path::new(entry.as_str().unwrap());
                path.is_absolute() && !path.starts_with(&repo) && !path.starts_with(snapshot)
            })
    );
    assert!(!advice.to_string().contains("fixture-private-source"));
}

#[test]
fn retains_a_literal_path_scope_in_the_selected_store() {
    let trial = prepared();
    let repo = trial.temporary.path().join("repo");
    put(repo.join("design[1].txt"), "literal design\n");
    put(repo.join("design1.txt"), "not selected\n");
    let selected = trial
        .temporary
        .path()
        .canonicalize()
        .unwrap()
        .join("private-store");
    let advice = result(
        request(&trial, "frontend-architect", "Inspect layout")
            .args(["--path", "design[1].txt", "--state-dir"])
            .arg(&selected)
            .env("CONSULT_READ", "after/design[1].txt"),
    );
    let snapshot = Path::new(advice["snapshot"].as_str().unwrap());
    assert_eq!(
        snapshot.parent().unwrap().parent(),
        Some(selected.as_path())
    );
    let scope = read_json(snapshot.join("scope.json"));
    assert_eq!(scope["scope"]["path_filter"], "design[1].txt");
    assert_eq!(scope["after"], json!(["design[1].txt"]));
    assert!(!store(&trial).exists());
}

#[test]
fn rejects_invalid_arguments_before_creating_state_or_starting_a_provider() {
    let trial = Trial::new();
    let selected = trial.temporary.path().join("unused-store");
    for options in INVALID_OPTIONS {
        let output = request(&trial, "api-designer", "Inspect")
            .arg("--state-dir")
            .arg(&selected)
            .args(*options)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2), "{options:?}");
        assert!(output.stdout.is_empty());
    }
    for agent in ["writer", "../../api-designer", "", "API-DESIGNER"] {
        assert_usage_error(&mut request(&trial, agent, "Inspect"));
    }
    for prompt in ["".to_owned(), "x".repeat(65_537)] {
        assert_usage_error(&mut request(&trial, "api-designer", &prompt));
    }
    for args in [
        &[][..],
        &["--help", "--model", "test"][..],
        &["--agent", "api-designer", "--prompt", "Inspect"][..],
        &["--agent", "api-designer", "--repo", "/missing"][..],
    ] {
        assert_usage_error(trial.consult_command().args(args));
    }
    assert!(!trial.log.exists());
    assert!(!trial.root.join(".state").exists());
    assert!(!selected.exists());
}

#[test]
fn rejects_invalid_state_paths_before_any_side_effects() {
    let trial = Trial::new();
    for state in ["relative", "/tmp/consult/../escape", ""] {
        assert_usage_error(request(&trial, "api-designer", "Inspect").args(["--state-dir", state]));
    }
    assert!(!trial.log.exists());
    assert!(!trial.root.join(".state").exists());
}

#[test]
fn requires_a_successful_scope_read_and_discards_failed_consultations() {
    let trial = prepared();
    for mode in [
        "no-scope",
        "failed-scope",
        "nonzero",
        "malformed",
        "no-settled",
    ] {
        let output = request(&trial, "change-reviewer", "Inspect")
            .env("CONSULT_MODE", mode)
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(1), "{mode}");
        assert!(output.stdout.is_empty(), "{mode}");
        assert!(!String::from_utf8_lossy(&output.stderr).contains("fixture-private-diagnostic"));
        assert_no_consultation(&store(&trial));
    }
}

#[test]
fn timeout_discards_pending_snapshot_without_a_false_result() {
    let trial = prepared();
    let start = Instant::now();
    let output = request(&trial, "api-designer", "Inspect")
        .args(["--timeout", "1"])
        .env("CONSULT_MODE", "wait")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(start.elapsed() < Duration::from_secs(5));
    assert_no_consultation(&store(&trial));
}

#[test]
fn cancellation_discards_pending_snapshot_without_a_false_result() {
    let trial = prepared();
    let child = request(&trial, "api-designer", "Inspect")
        .env("CONSULT_MODE", "wait")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let started = Instant::now();
    while !trial.log.exists() && started.elapsed() < Duration::from_secs(5) {
        std::thread::sleep(Duration::from_millis(10));
    }
    assert!(trial.log.exists(), "fixture provider did not start");
    unsafe {
        libc::kill(child.id() as i32, libc::SIGINT);
    }
    let output = child.wait_with_output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert_no_consultation(&store(&trial));
}

#[test]
fn requires_a_committed_repository_before_creating_consultation_state() {
    let trial = prepared();
    let repo = trial.temporary.path().join("repo");
    fs::remove_dir_all(repo.join(".git")).unwrap();
    git(&trial, &["init", "-b", "main"]);
    let output = request(&trial, "api-designer", "Inspect").output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    assert!(!trial.log.exists());
    assert!(!store(&trial).exists());
}

#[test]
fn rejects_pi_only_options_for_claude_before_creating_review_state() {
    let trial = Trial::new();
    for options in [
        &["--engine", "unknown"][..],
        &["--engine", "claude", "--provider", "fixture"],
        &["--engine", "claude", "--thinking", "high"],
    ] {
        assert_usage_error(request(&trial, "api-designer", "Inspect").args(options));
    }
    assert!(!trial.log.exists());
    assert!(!trial.profile().exists());
}

#[test]
fn help_explains_the_committed_repository_requirement_without_installing() {
    let trial = Trial::new();
    let output = trial.consult_command().arg("--help").output().unwrap();
    success(output.clone());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.contains("committed Git repository"));
    assert!(!help.contains("Oversized snapshots"));
    assert!(help.contains("Command output limits and process timeouts"));
    assert!(help.contains("--agent"));
    assert!(!trial.log.exists());
    assert!(!trial.profile().exists());
}

const INVALID_OPTIONS: &[&[&str]] = &[
    &["--tools", "bash"],
    &["--extension", "foreign.ts"],
    &["--agent", "fact-checker"],
    &["--timeout", "0"],
    &["--timeout", "3601"],
    &["--timeout", "no"],
    &["--timeout", "1", "--timeout", "2"],
    &["--model", "--approve"],
    &["--thinking", "invented"],
    &["--provider", ""],
    &["--path", "../outside"],
    &["--path", "/absolute"],
    &["--unknown", "value"],
    &["stray"],
    &["--model"],
];
