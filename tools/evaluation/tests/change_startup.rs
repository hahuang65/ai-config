mod support;
use std::fs;
use support::{change::*, *};

#[test]
fn missing_promised_objects_never_start_a_fetch_or_source_ssh_command() {
    let trial = fixture();
    let marker = trial.temporary.path().join("ssh-executed");
    let script = trial.temporary.path().join("repo/source-ssh");
    executable(
        &script,
        &format!(
            "#!/usr/bin/env python3\nfrom pathlib import Path\nPath({:?}).write_text('bad')\nraise SystemExit(1)\n",
            marker.to_str().unwrap()
        ),
    );
    git(
        &trial,
        &[
            "remote",
            "add",
            "origin",
            "ssh://fixture.invalid/repository",
        ],
    );
    git(&trial, &["config", "remote.origin.promisor", "true"]);
    git(
        &trial,
        &["config", "core.sshCommand", script.to_str().unwrap()],
    );
    let oid = git(&trial, &["rev-parse", "HEAD:source.txt"]);
    fs::remove_file(
        trial
            .temporary
            .path()
            .join("repo/.git/objects")
            .join(&oid[..2])
            .join(&oid[2..]),
    )
    .unwrap();
    let output = review(&trial, &["range", "HEAD~1..HEAD"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(
        !marker.exists(),
        "Git invoked source-controlled SSH while trying to fetch"
    );
    assert!(output.stdout.is_empty());
}

#[test]
fn a_trusted_bash_launcher_does_not_source_the_reviewed_bash_env() {
    let trial = fixture();
    let model = trial.temporary.path().join("model.py");
    fs::copy(trial.fake_bin.join("pi"), &model).unwrap();
    executable(
        trial.fake_bin.join("pi"),
        "#!/bin/bash\nexec python3 \"$FAKE_PI_MODEL\" \"$@\"\n",
    );
    let startup = trial.temporary.path().join("repo/startup.sh");
    let marker = trial.temporary.path().join("shell-startup-executed");
    put(&startup, "/usr/bin/touch \"$STARTUP_MARKER\"\n");
    let output = command(&trial)
        .env("BASH_ENV", startup)
        .env("STARTUP_MARKER", &marker)
        .env("FAKE_PI_MODEL", model)
        .args(["review", "range", "HEAD~1..HEAD", "--repo"])
        .arg(trial.temporary.path().join("repo"))
        .args(["--intent", "fixture", "--json"])
        .output()
        .unwrap();
    assert!(!marker.exists(), "Bash startup executed reviewed source");
    success(output);
}
