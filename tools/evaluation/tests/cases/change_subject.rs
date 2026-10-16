use crate::support::{change::*, *};
use serde_json::Value;
use std::{fs, path::Path};

#[test]
fn help_leads_with_one_optional_subject_and_no_report_management_commands() {
    let trial = Trial::new();
    let output = command(&trial).arg("--help").output().unwrap();
    success(output.clone());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(help.starts_with("Usage: review-change [SUBJECT]"));
    assert!(help.contains("PR URL"));
    assert!(!help.contains("post REPORT"));
    assert!(!help.contains("requires --intent"));
    assert!(!trial.home.join(".local/state").exists());
}

#[test]
fn human_review_uses_commit_context_without_claiming_explicit_acceptance_criteria() {
    let trial = fixture();
    let output = command(&trial)
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--json")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let record = read_json(receipt["record"].as_str().unwrap());
    let intent = record["intent"].as_str().unwrap();
    assert!(intent.contains("Commit context (unverified intent):"));
    assert!(intent.contains("change"));
    assert!(intent.contains("No explicit acceptance criteria"));
}

#[test]
fn human_review_opens_the_bound_report_in_artifact_review_not_a_terminal_publisher() {
    let trial = fixture();
    let marker = trial.temporary.path().join("artifact-opened");
    executable(
        trial
            .root
            .join("tools/artifact-review/target/release/review-artifact"),
        "#!/usr/bin/env python3\nimport os,sys,json\njson.dump(sys.argv[1:],open(os.environ['ARTIFACT_OPEN_MARKER'],'w'))\n",
    );
    let output = command(&trial)
        .env("ARTIFACT_OPEN_MARKER", &marker)
        .arg("HEAD~1..HEAD")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .output()
        .unwrap();
    success(output);
    let arguments = read_json(marker);
    assert_eq!(arguments[0], "open");
    assert_eq!(arguments[2], "--findings");
    assert_eq!(
        Path::new(arguments[1].as_str().unwrap())
            .file_name()
            .unwrap(),
        "report.html"
    );
    assert_eq!(
        Path::new(arguments[3].as_str().unwrap())
            .file_name()
            .unwrap(),
        "report.json"
    );
}

#[test]
fn human_pr_from_outside_git_acquires_objects_without_touching_the_development_repo() {
    let trial = fixture();
    let provider = provider(&trial);
    let repo = trial.temporary.path().join("repo");
    let refs = git(&trial, &["show-ref"]);
    let index = fs::read(repo.join(".git/index")).unwrap();
    let output = remote_command(&trial)
        .env("CHANGE_PROVIDER", provider)
        .arg("https://github.com/fixture/repo/pull/7")
        .arg("--json")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let snapshot = Path::new(receipt["snapshot"].as_str().unwrap());
    assert_eq!(
        fs::read(snapshot.join("before/source.txt")).unwrap(),
        b"before\n"
    );
    assert_eq!(
        fs::read(snapshot.join("after/source.txt")).unwrap(),
        b"after\n"
    );
    assert_eq!(git(&trial, &["show-ref"]), refs);
    assert_eq!(fs::read(repo.join(".git/index")).unwrap(), index);
}

fn remote_command(trial: &Trial) -> std::process::Command {
    let outside = trial.temporary.path().join("outside");
    fs::create_dir_all(&outside).unwrap();
    let real_git = std::process::Command::new("which")
        .arg("git")
        .output()
        .unwrap();
    let real_git = String::from_utf8(real_git.stdout)
        .unwrap()
        .trim()
        .to_owned();
    executable(
        trial.fake_bin.join("git"),
        "#!/usr/bin/env python3\nimport os,sys\na=sys.argv[1:]\nif 'fetch' in a:\n assert 'https://github.com/fixture/repo.git' in a\n a[a.index('https://github.com/fixture/repo.git')]=os.environ['SUBJECT_FIXTURE_REPO']\nos.execv(os.environ['SUBJECT_REAL_GIT'],[os.environ['SUBJECT_REAL_GIT']]+a)\n",
    );
    let mut command = command(trial);
    command
        .current_dir(outside)
        .env("SUBJECT_REAL_GIT", real_git)
        .env("SUBJECT_FIXTURE_REPO", trial.temporary.path().join("repo"));
    command
}

#[test]
fn github_branch_url_resolves_encoded_branch_against_the_provider_default() {
    let trial = fixture();
    let data = provider(&trial);
    executable(
        trial.fake_bin.join("gh"),
        r#"#!/usr/bin/env python3
import json,os,sys
p=json.load(open(os.environ['CHANGE_PROVIDER']))
endpoint=sys.argv[2]
if endpoint == 'repos/fixture/repo':
 print(json.dumps({'id':9,'full_name':'fixture/repo','default_branch':'integration'}))
elif endpoint == 'repos/fixture/repo/git/ref/heads/feature%2Ftopic':
 print(json.dumps({'ref':'refs/heads/feature/topic','object':{'type':'commit','sha':p['head']}}))
elif endpoint == 'repos/fixture/repo/git/ref/heads/integration':
 print(json.dumps({'ref':'refs/heads/integration','object':{'type':'commit','sha':p['base']}}))
else: sys.exit(9)
"#,
    );
    let output = remote_command(&trial)
        .env("CHANGE_PROVIDER", data)
        .arg("https://github.com/fixture/repo/tree/feature%2Ftopic")
        .arg("--json")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let record = read_json(receipt["record"].as_str().unwrap());
    assert_eq!(
        record["scope"]["repository"],
        "https://github.com/fixture/repo"
    );
    assert!(record["scope"]["pull_request"].is_null());
    let snapshot = Path::new(receipt["snapshot"].as_str().unwrap());
    assert_eq!(
        fs::read(snapshot.join("before/source.txt")).unwrap(),
        b"before\n"
    );
    assert_eq!(
        fs::read(snapshot.join("after/source.txt")).unwrap(),
        b"after\n"
    );
}

#[test]
fn trunk_prefers_remote_default_and_fails_on_ambiguous_fallback_without_a_review() {
    let trial = fixture();
    git(&trial, &["branch", "-m", "feature"]);
    git(&trial, &["branch", "main", "HEAD~1"]);
    git(&trial, &["branch", "master", "HEAD~1"]);
    let repo = trial.temporary.path().join("repo");
    let output = command(&trial)
        .current_dir(&repo)
        .arg("--json")
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("Both main and master"));
    assert!(output.stdout.is_empty());
    assert!(
        !trial
            .home
            .join(".local/state/ai-config/change-reviews")
            .exists()
    );
    git(
        &trial,
        &["update-ref", "refs/remotes/origin/integration", "HEAD~1"],
    );
    git(
        &trial,
        &[
            "symbolic-ref",
            "refs/remotes/origin/HEAD",
            "refs/remotes/origin/integration",
        ],
    );
    let output = command(&trial)
        .current_dir(&repo)
        .arg("--json")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let record = read_json(receipt["record"].as_str().unwrap());
    assert_eq!(
        record["scope"]["base"],
        git(&trial, &["rev-parse", "origin/integration"])
    );
}

#[test]
fn named_worktree_reviews_its_branch_and_dirty_files_not_the_callers() {
    let trial = fixture();
    git(&trial, &["branch", "-m", "feature/topic"]);
    git(&trial, &["branch", "main", "HEAD~1"]);
    git(&trial, &["switch", "main"]);
    let selected = trial.temporary.path().join("other task");
    git(
        &trial,
        &[
            "worktree",
            "add",
            selected.to_str().unwrap(),
            "feature/topic",
        ],
    );
    put(selected.join("source.txt"), "selected worktree edits\n");
    put(selected.join("untracked.txt"), "selected new file\n");
    let repo = trial.temporary.path().join("repo");
    put(repo.join("caller-only.txt"), "not selected\n");
    for subject in ["other task", "feature/topic"] {
        let output = command(&trial)
            .current_dir(&repo)
            .arg(subject)
            .arg("--json")
            .output()
            .unwrap();
        success(output.clone());
        let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
        let snapshot = Path::new(receipt["snapshot"].as_str().unwrap());
        let scope: Value =
            serde_json::from_slice(&fs::read(snapshot.join("scope.json")).unwrap()).unwrap();
        assert_eq!(
            scope["scope"]["repository"],
            selected.canonicalize().unwrap().to_str().unwrap()
        );
        assert_eq!(
            fs::read(snapshot.join("after/source.txt")).unwrap(),
            b"selected worktree edits\n"
        );
        assert!(snapshot.join("after/untracked.txt").exists());
        assert!(!snapshot.join("after/caller-only.txt").exists());
        let record = read_json(receipt["record"].as_str().unwrap());
        assert_eq!(record["display"]["repository"], "repo");
        assert_eq!(
            record["display"]["comparison"],
            "main → feature/topic + outstanding changes"
        );
    }
    assert_eq!(git(&trial, &["branch", "--show-current"]), "main");
}

#[test]
fn a_pr_url_is_the_only_required_subject() {
    let trial = fixture();
    let provider = provider(&trial);
    let output = command(&trial)
        .env("CHANGE_PROVIDER", &provider)
        .arg("https://github.com/fixture/repo/pull/7")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--json")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let record: Value =
        serde_json::from_slice(&fs::read(receipt["record"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(
        record["scope"]["pull_request"]["url"],
        "https://github.com/fixture/repo/pull/7"
    );
    assert_eq!(record["display"]["repository"], "repo");
    assert_eq!(record["display"]["comparison"], "Pull request #7 changes");
    assert_eq!(read_json(provider)["posts"], 0);
}

#[test]
fn no_subject_reviews_branch_commits_and_outstanding_changes_without_mutating_git() {
    let trial = fixture();
    git(&trial, &["branch", "-m", "feature"]);
    git(&trial, &["branch", "main", "HEAD~1"]);
    let repo = trial.temporary.path().join("repo");
    put(repo.join("source.txt"), "outstanding\n");
    put(repo.join("staged.txt"), "staged\n");
    git(&trial, &["add", "staged.txt"]);
    put(repo.join("untracked.txt"), "untracked\n");
    let index = fs::read(repo.join(".git/index")).unwrap();
    let refs = git(&trial, &["show-ref"]);
    let output = command(&trial)
        .current_dir(&repo)
        .arg("--json")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let snapshot = Path::new(receipt["snapshot"].as_str().unwrap());
    let scope: Value =
        serde_json::from_slice(&fs::read(snapshot.join("scope.json")).unwrap()).unwrap();
    assert_eq!(
        scope["scope"]["comparison_base"],
        git(&trial, &["rev-parse", "main"])
    );
    assert_eq!(
        fs::read(snapshot.join("before/source.txt")).unwrap(),
        b"before\n"
    );
    assert_eq!(
        fs::read(snapshot.join("after/source.txt")).unwrap(),
        b"outstanding\n"
    );
    assert!(snapshot.join("after/staged.txt").exists());
    assert!(snapshot.join("after/untracked.txt").exists());
    assert_eq!(fs::read(repo.join(".git/index")).unwrap(), index);
    assert_eq!(git(&trial, &["show-ref"]), refs);
}

#[test]
fn human_range_accepts_git_revision_expressions_without_manual_intent() {
    let trial = fixture();
    git(&trial, &["tag", "release-v1", "HEAD~1"]);
    let output = command(&trial)
        .arg("release-v1^{commit}..HEAD@{0}")
        .arg("--repo")
        .arg(trial.temporary.path().join("repo"))
        .arg("--json")
        .output()
        .unwrap();
    success(output.clone());
    let receipt: Value = serde_json::from_slice(&output.stdout).unwrap();
    let record: Value =
        serde_json::from_slice(&fs::read(receipt["record"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(
        record["scope"]["base"],
        git(&trial, &["rev-parse", "release-v1"])
    );
    assert_eq!(record["scope"]["head"], git(&trial, &["rev-parse", "HEAD"]));
    let snapshot = Path::new(receipt["snapshot"].as_str().unwrap());
    assert_eq!(
        fs::read(snapshot.join("before/source.txt")).unwrap(),
        b"before\n"
    );
    assert_eq!(
        fs::read(snapshot.join("after/source.txt")).unwrap(),
        b"after\n"
    );
    assert!(!record["intent"].as_str().unwrap().is_empty());
}
