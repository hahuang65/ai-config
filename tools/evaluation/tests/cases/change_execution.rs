use crate::support::{change::*, *};
use std::{fs, path::PathBuf, process::Command};

fn real_git() -> String {
    String::from_utf8(Command::new("which").arg("git").output().unwrap().stdout)
        .unwrap()
        .trim()
        .to_owned()
}

fn remote_fixture(trial: &Trial) -> PathBuf {
    let data = provider(trial);
    executable(
        trial.fake_bin.join("gh"),
        r#"#!/usr/bin/env python3
import os,sys,json
p=json.load(open(os.environ['CHANGE_PROVIDER'])); e=sys.argv[2].split('?')[0]
if e == 'repos/fixture/repo': print(json.dumps({'id':9,'full_name':'fixture/repo','default_branch':'main'}))
elif e == 'repos/fixture/repo/git/ref/heads/main': print(json.dumps({'ref':'refs/heads/main','object':{'type':'commit','sha':p['base']}}))
elif e == 'repos/fixture/repo/git/ref/heads/feature': print(json.dumps({'ref':'refs/heads/feature','object':{'type':'commit','sha':p['head']}}))
else: sys.exit(9)
"#,
    );
    executable(
        trial.fake_bin.join("git"),
        r#"#!/usr/bin/env python3
import os,sys
a=sys.argv[1:]
if 'fetch' in a:
 assert 'https://github.com/fixture/repo.git' in a
 a[a.index('https://github.com/fixture/repo.git')]=os.environ['EXECUTION_FIXTURE_REPO']
os.execv(os.environ['EXECUTION_REAL_GIT'],[os.environ['EXECUTION_REAL_GIT']]+a)
"#,
    );
    data
}

#[test]
fn automatic_artifact_opening_never_uses_a_checkout_controlled_browser_opener() {
    for alias in [false, true] {
        let trial = fixture();
        let repo = trial.temporary.path().join("repo");
        let unsafe_marker = trial.temporary.path().join("unsafe-opener");
        let trusted_marker = trial.temporary.path().join("trusted-opener");
        let helper = artifact_helper(&trial);
        let artifact_state = trial.temporary.path().join("artifact-state");
        let path = browser_fixture_path(&trial, alias);
        let output = command(&trial)
            .current_dir(&repo)
            .env("PATH", path)
            .env("AR_ROOT", &artifact_state)
            .env("UNSAFE_OPENER_MARKER", &unsafe_marker)
            .env("TRUSTED_OPENER_MARKER", &trusted_marker)
            .arg("HEAD~1..HEAD")
            .output()
            .unwrap();
        stop_artifacts(&trial, &helper, &artifact_state);
        assert!(
            !unsafe_marker.exists(),
            "Checkout opener executed (external alias: {alias})"
        );
        success(output);
        assert!(trusted_marker.exists(), "Trusted opener was not selected");
    }
}

#[test]
fn independently_reopened_reports_restore_source_exclusions_across_server_restarts() {
    let trial = fixture();
    let outside = trial.temporary.path().join("outside");
    fs::create_dir(&outside).unwrap();
    let output = command(&trial)
        .current_dir(&outside)
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--json")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: serde_json::Value = serde_json::from_slice(&output.stdout).unwrap();
    let helper = artifact_helper(&trial);
    let artifact_state = trial.temporary.path().join("artifact-state");
    let unsafe_marker = trial.temporary.path().join("unsafe-opener");
    let trusted_marker = trial.temporary.path().join("trusted-opener");
    let path = browser_fixture_path(&trial, false);
    for _ in 0..2 {
        let output = Command::new(&helper)
            .current_dir(&outside)
            .env("HOME", &trial.home)
            .env("AR_ROOT", &artifact_state)
            .env("PATH", &path)
            .env_remove("AI_REVIEW_EXCLUDED_SOURCES")
            .env("UNSAFE_OPENER_MARKER", &unsafe_marker)
            .env("TRUSTED_OPENER_MARKER", &trusted_marker)
            .arg("open")
            .arg(receipt["report"].as_str().unwrap())
            .arg("--findings")
            .arg(receipt["record"].as_str().unwrap())
            .output()
            .unwrap();
        stop_artifacts(&trial, &helper, &artifact_state);
        assert!(
            !unsafe_marker.exists(),
            "Independent open lost the source exclusion"
        );
        success(output);
        assert!(trusted_marker.exists());
        fs::remove_file(&trusted_marker).unwrap();
    }
}

fn artifact_helper(trial: &Trial) -> PathBuf {
    let helper = trial
        .root
        .join("tools/artifact-review/target/release/review-artifact");
    fs::copy(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../artifact-review/target/release/review-artifact"),
        &helper,
    )
    .expect("Run make build before the artifact opener regression");
    helper
}

fn browser_fixture_path(trial: &Trial, alias: bool) -> String {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else {
        "xdg-open"
    };
    let unsafe_bin = trial.temporary.path().join("repo/bin");
    let trusted_bin = trial.temporary.path().join("trusted-browser-bin");
    executable(
        unsafe_bin.join(opener),
        "#!/bin/sh\nprintf unsafe > \"$UNSAFE_OPENER_MARKER\"\n",
    );
    executable(
        trusted_bin.join(opener),
        "#!/bin/sh\nprintf trusted > \"$TRUSTED_OPENER_MARKER\"\n",
    );
    if alias {
        std::os::unix::fs::symlink(unsafe_bin.join(opener), trial.fake_bin.join(opener)).unwrap();
    }
    format!(
        "{}:{}:{}:{}",
        unsafe_bin.display(),
        trial.fake_bin.display(),
        trusted_bin.display(),
        std::env::var("PATH").unwrap()
    )
}

fn stop_artifacts(trial: &Trial, helper: &std::path::Path, state: &std::path::Path) {
    let store = trial.home.join(".local/state/ai-config/change-reviews");
    if let Ok(entries) = fs::read_dir(store) {
        for entry in entries.flatten() {
            let report = entry.path().join("report.html");
            if report.is_file() {
                let output = Command::new(helper)
                    .env("HOME", &trial.home)
                    .env("AR_ROOT", state)
                    .arg("stop")
                    .arg(report)
                    .output()
                    .unwrap();
                success(output);
            }
        }
    }
}

#[test]
fn pr_acquisition_keeps_source_exclusions_after_switching_to_temporary_git() {
    let trial = fixture();
    remote_fixture(&trial);
    let data = provider(&trial);
    let repo = trial.temporary.path().join("repo");
    let remote = trial.temporary.path().join("remote.git");
    clone_remote(&trial, &repo, &remote);
    let head = git(&trial, &["rev-parse", "HEAD"]);
    fs::remove_file(repo.join(".git/objects").join(&head[..2]).join(&head[2..])).unwrap();
    let index = fs::read(repo.join(".git/index")).unwrap();
    let marker = trial.temporary.path().join("source-git-ran");
    executable(
        repo.join("bin/git"),
        "#!/bin/sh\nprintf unsafe > \"$EXECUTION_MARKER\"\nexit 19\n",
    );
    let output = command(&trial)
        .current_dir(&repo)
        .env(
            "PATH",
            format!(
                "{}:{}:{}",
                repo.join("bin").display(),
                trial.fake_bin.display(),
                std::env::var("PATH").unwrap()
            ),
        )
        .env("CHANGE_PROVIDER", data)
        .env("EXECUTION_MARKER", &marker)
        .env("EXECUTION_REAL_GIT", real_git())
        .env("EXECUTION_FIXTURE_REPO", remote)
        .arg("https://github.com/fixture/repo/pull/7")
        .arg("--json")
        .output()
        .unwrap();
    assert!(
        !marker.exists(),
        "Source git executed after changing acquisition directory"
    );
    success(output);
    assert_eq!(fs::read(repo.join(".git/index")).unwrap(), index);
}

fn clone_remote(trial: &Trial, repo: &std::path::Path, remote: &std::path::Path) {
    git(
        trial,
        &[
            "clone",
            "--quiet",
            "--bare",
            "--no-hardlinks",
            repo.to_str().unwrap(),
            remote.to_str().unwrap(),
        ],
    );
}

#[test]
fn github_acquisition_excludes_checkout_controlled_gh_and_git() {
    let trial = fixture();
    let data = remote_fixture(&trial);
    let repo = trial.temporary.path().join("repo");
    let marker = trial.temporary.path().join("checkout-executable-ran");
    for (name, outside) in [
        ("gh", false),
        ("git", false),
        ("pi", false),
        ("git", true),
        ("pi", true),
    ] {
        executable(
            repo.join("bin").join(name),
            "#!/bin/sh\nprintf unsafe > \"$EXECUTION_MARKER\"\nexit 19\n",
        );
        let path = format!(
            "{}:{}:{}",
            repo.join("bin").display(),
            trial.fake_bin.display(),
            std::env::var("PATH").unwrap()
        );
        let invocation = if outside {
            trial.temporary.path().join("outside")
        } else {
            repo.clone()
        };
        fs::create_dir_all(&invocation).unwrap();
        let output = command(&trial)
            .current_dir(invocation)
            .env("PATH", path)
            .env("CHANGE_PROVIDER", &data)
            .env("EXECUTION_MARKER", &marker)
            .env("EXECUTION_REAL_GIT", real_git())
            .env("EXECUTION_FIXTURE_REPO", &repo)
            .arg("https://github.com/fixture/repo/tree/feature")
            .arg("--repo")
            .arg(&repo)
            .arg("--json")
            .output()
            .unwrap();
        assert!(
            !marker.exists(),
            "Checkout-controlled {name} executed during acquisition"
        );
        success(output);
        fs::remove_file(repo.join("bin").join(name)).unwrap();
    }
}
