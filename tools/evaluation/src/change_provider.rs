use crate::{
    change_command, change_git as git, change_snapshot,
    change_types::{PullRequest, Scope, relative_path},
    reviewer_process,
};
use anyhow::{Context, Result, ensure};
use serde_json::Value;
use std::{collections::BTreeSet, path::Path};

pub fn identity(url: &str) -> Result<PullRequest> {
    let parts: Vec<_> = url
        .strip_prefix("https://github.com/")
        .context("Use an HTTPS github.com pull-request URL")?
        .split('/')
        .collect();
    ensure!(
        parts.len() == 4 && parts[2] == "pull",
        "Use https://github.com/OWNER/REPO/pull/NUMBER"
    );
    for name in &parts[..2] {
        ensure!(
            !name.is_empty()
                && !matches!(*name, "." | "..")
                && name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b)),
            "Invalid GitHub owner or repository"
        );
    }
    let number: u64 = parts[3].parse().context("Invalid pull-request number")?;
    ensure!(number > 0, "Pull-request number must be positive");
    let (owner, repo) = (parts[0].to_lowercase(), parts[1].to_lowercase());
    Ok(PullRequest {
        url: format!("https://github.com/{owner}/{repo}/pull/{number}"),
        owner,
        repo,
        number,
        id: 0,
        repository_id: 0,
    })
}

pub fn endpoint(pr: &PullRequest) -> String {
    format!("repos/{}/{}/pulls/{}", pr.owner, pr.repo, pr.number)
}

pub fn api(excluded: &Path, endpoint: &str, input: Option<&Path>) -> Result<Value> {
    let mut command = change_command::command("gh", &[excluded])?;
    command.args([
        "api",
        endpoint,
        "--hostname",
        "github.com",
        "-H",
        "Accept: application/vnd.github+json",
        "-H",
        "X-GitHub-Api-Version: 2022-11-28",
    ]);
    if let Some(input) = input {
        command.args(["--method", "POST", "--input"]).arg(input);
    }
    let output = reviewer_process::run(command, 30)
        .context("GitHub request failed; no raw provider diagnostics were printed")?;
    serde_json::from_slice(&output).map_err(|_| anyhow::anyhow!("GitHub returned invalid JSON"))
}

pub fn resolve(repo: &Path, expected: &PullRequest) -> Result<(PullRequest, String, String, bool)> {
    let response = api(repo, &endpoint(expected), None)?;
    let mut actual = identity(
        response["html_url"]
            .as_str()
            .context("GitHub omitted the pull-request URL")?,
    )?;
    actual.id = response["id"]
        .as_u64()
        .filter(|n| *n > 0)
        .context("GitHub omitted the pull-request identity")?;
    actual.repository_id = response["base"]["repo"]["id"]
        .as_u64()
        .filter(|n| *n > 0)
        .context("GitHub omitted the repository identity")?;
    ensure!(
        actual.url == expected.url && response["number"].as_u64() == Some(expected.number),
        "GitHub returned a different pull request"
    );
    ensure!(
        response["base"]["repo"]["full_name"].as_str().is_some_and(
            |n| n.eq_ignore_ascii_case(&format!("{}/{}", expected.owner, expected.repo))
        ),
        "GitHub returned a different repository"
    );
    let base = response["base"]["sha"]
        .as_str()
        .filter(|s| git::valid_oid(s))
        .context("GitHub omitted the base commit")?
        .to_owned();
    let head = response["head"]["sha"]
        .as_str()
        .filter(|s| git::valid_oid(s))
        .context("GitHub omitted the head commit")?
        .to_owned();
    ensure!(
        matches!(response["state"].as_str(), Some("open" | "closed")),
        "GitHub omitted the pull-request state"
    );
    Ok((actual, base, head, response["state"] == "open"))
}

pub fn check(scope: &Scope) -> Result<()> {
    let expected = scope
        .pull_request
        .as_ref()
        .context("Local reviews cannot post")?;
    let (actual, base, head, open) = resolve(Path::new(&scope.repository), expected)?;
    ensure!(
        &actual == expected && base == scope.base && head == scope.head && open,
        "Pull-request identity, revisions, or state changed; run a fresh review"
    );
    Ok(())
}

pub fn pages(repo: &Path, endpoint: &str, maximum: usize) -> Result<Vec<Value>> {
    let mut all = vec![];
    for page in 1..=maximum / 100 + 1 {
        let response = api(repo, &format!("{endpoint}?per_page=100&page={page}"), None)?;
        let rows = response
            .as_array()
            .context("GitHub returned an invalid collection")?;
        ensure!(
            rows.len() <= 100 && all.len() + rows.len() <= maximum,
            "GitHub collection exceeds its supported limit; outcome is not established"
        );
        all.extend(rows.iter().cloned());
        if rows.len() < 100 {
            return Ok(all);
        }
    }
    anyhow::bail!("GitHub collection is incomplete")
}

pub fn lines(repo: &Path, pr: &PullRequest) -> Result<BTreeSet<(String, String, u64)>> {
    let mut proven = BTreeSet::new();
    for file in pages(repo, &format!("{}/files", endpoint(pr)), 2000)? {
        let path = file["filename"]
            .as_str()
            .context("GitHub omitted a changed file path")?;
        relative_path(path)?;
        if let Some(patch) = file["patch"].as_str() {
            let old = serde_json::to_string(&format!("a/before/{path}"))?;
            let new = serde_json::to_string(&format!("b/after/{path}"))?;
            // Missing or truncated provider patches do not prove any inline location.
            if let Ok(lines) = change_snapshot::lines(&format!("--- {old}\n+++ {new}\n{patch}\n")) {
                proven.extend(lines);
            }
        }
    }
    Ok(proven)
}
