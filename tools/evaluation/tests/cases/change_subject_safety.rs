use crate::support::{change::*, *};
use serde_json::Value;

#[test]
fn scheme_less_github_urls_keep_url_validation_before_external_commands() {
    let trial = Trial::new();
    let marker = trial.temporary.path().join("external-command");
    for program in ["git", "gh", "pi"] {
        executable(
            trial.fake_bin.join(program),
            "#!/bin/sh\ntouch \"$SUBJECT_COMMAND_MARKER\"\nexit 1\n",
        );
    }
    for subject in [
        "github.com/fixture/repo/pull/0",
        "github.com/fixture/repo/pull/nope",
        "github.com/fixture/repo/pull/7/unsupported",
        "github.com/fixture@other.example/repo/pull/7",
        "github.com/../repo/pull/7",
    ] {
        let output = command(&trial)
            .env("SUBJECT_COMMAND_MARKER", &marker)
            .arg(subject)
            .arg("--json")
            .output()
            .unwrap();
        assert_eq!(output.status.code(), Some(2), "{subject}");
        assert!(output.stdout.is_empty(), "{subject}");
        assert!(!marker.exists(), "{subject}");
    }
    assert!(!trial.home.join(".local/state").exists());
}

#[test]
fn detached_worktree_attached_at_the_same_commit_is_a_changed_binding() {
    let trial = fixture();
    git(&trial, &["branch", "same-head"]);
    let selected = trial.temporary.path().join("selected");
    git(
        &trial,
        &[
            "worktree",
            "add",
            "--detach",
            selected.to_str().unwrap(),
            "HEAD",
        ],
    );
    let real = std::process::Command::new("which")
        .arg("git")
        .output()
        .unwrap();
    let real = String::from_utf8(real.stdout).unwrap().trim().to_owned();
    executable(
        trial.fake_bin.join("git"),
        r#"#!/usr/bin/env python3
import os,subprocess,sys
a=sys.argv[1:]; real=os.environ['SUBJECT_REAL_GIT']
if 'worktree' in a and 'list' in a:
 output=subprocess.check_output([real]+a)
 subprocess.check_call([real,'-C',os.environ['SELECTED_WORKTREE'],'switch','same-head'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 sys.stdout.buffer.write(output)
else: os.execv(real,[real]+a)
"#,
    );
    let output = command(&trial)
        .env("SUBJECT_REAL_GIT", real)
        .env("SELECTED_WORKTREE", selected)
        .arg("selected")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--json")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("Selected worktree changed"));
    assert!(output.stdout.is_empty());
    assert!(
        !trial
            .home
            .join(".local/state/ai-config/change-reviews")
            .exists()
    );
}

#[test]
fn changed_worktree_binding_is_rejected_before_a_report_is_created() {
    let trial = fixture();
    git(&trial, &["branch", "-m", "feature/topic"]);
    git(&trial, &["branch", "main", "HEAD~1"]);
    git(&trial, &["branch", "unrelated", "HEAD~1"]);
    git(&trial, &["switch", "main"]);
    let selected = trial.temporary.path().join("selected");
    git(
        &trial,
        &[
            "worktree",
            "add",
            selected.to_str().unwrap(),
            "feature/topic",
        ],
    );
    let real = std::process::Command::new("which")
        .arg("git")
        .output()
        .unwrap();
    let real = String::from_utf8(real.stdout).unwrap().trim().to_owned();
    executable(
        trial.fake_bin.join("git"),
        r#"#!/usr/bin/env python3
import os,subprocess,sys
a=sys.argv[1:]; real=os.environ['SUBJECT_REAL_GIT']
if 'worktree' in a and 'list' in a:
 output=subprocess.check_output([real]+a)
 subprocess.check_call([real,'-C',os.environ['SELECTED_WORKTREE'],'switch','unrelated'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 sys.stdout.buffer.write(output)
else: os.execv(real,[real]+a)
"#,
    );
    let output = command(&trial)
        .env("SUBJECT_REAL_GIT", real)
        .env("SELECTED_WORKTREE", selected)
        .arg("feature/topic")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--json")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("Selected worktree changed"));
    assert!(output.stdout.is_empty());
    assert!(
        !trial
            .home
            .join(".local/state/ai-config/change-reviews")
            .exists()
    );
}

#[test]
fn range_endpoints_default_to_head_exactly_as_git_does() {
    let trial = fixture();
    let repo = trial.temporary.path().join("repo");
    for (range, base) in [("HEAD~1..", "HEAD~1"), ("..HEAD", "HEAD")] {
        let output = command(&trial)
            .arg(range)
            .arg("--repo")
            .arg(&repo)
            .arg("--json")
            .output()
            .unwrap();
        success(output.clone());
        let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
        let record = read_json(receipt["record"].as_str().unwrap());
        assert_eq!(record["scope"]["base"], git(&trial, &["rev-parse", base]));
        assert_eq!(record["scope"]["head"], git(&trial, &["rev-parse", "HEAD"]));
    }
}
