//! Human GitHub targets acquire missing objects only in an isolated, unmaterialized repository.
use crate::{change_args::Target, change_git as git, change_provider as provider};
use anyhow::{Context, Result, ensure};
use std::path::{Path, PathBuf};

pub struct Acquisition {
    pub directory: tempfile::TempDir,
    pub target: Target,
    pub url: String,
}

pub fn acquire(repo: &Path, url: &str) -> Result<Option<Acquisition>> {
    match crate::change_url::parse(url)? {
        crate::change_url::Subject::Pull(identity) => pull(repo, &identity.url),
        crate::change_url::Subject::Branch { repository, branch } => Ok(Some(branch_acquisition(
            repo,
            &repository,
            branch.as_deref(),
        )?)),
    }
}

fn branch_acquisition(repo: &Path, url: &str, branch: Option<&str>) -> Result<Acquisition> {
    let identity = provider::identity(&format!("{url}/pull/1"))?;
    let endpoint = format!("repos/{}/{}", identity.owner, identity.repo);
    let metadata = provider::api(repo, &endpoint, None)?;
    ensure!(
        metadata["id"].as_u64().is_some_and(|id| id > 0)
            && metadata["full_name"]
                .as_str()
                .is_some_and(|name| name
                    .eq_ignore_ascii_case(&format!("{}/{}", identity.owner, identity.repo))),
        "GitHub returned a different repository"
    );
    let default = metadata["default_branch"]
        .as_str()
        .context("GitHub omitted the default branch")?;
    let directory = tempfile::Builder::new()
        .prefix("change-review-source-")
        .tempdir()?;
    let root = directory.path().canonicalize()?;
    git::run(&root, &["init", "--quiet", "--template="])?;
    let base = branch_commit(repo, &root, &endpoint, default)?;
    let head = branch_commit(repo, &root, &endpoint, branch.unwrap_or(default))?;
    fetch(&root, &format!("{url}.git"), &[&base, &head])?;
    let base = crate::change_subject::merge_base(&root, &base, &head)?;
    Ok(Acquisition {
        directory,
        target: Target::Range(base, head),
        url: url.into(),
    })
}

fn branch_commit(repo: &Path, root: &Path, endpoint: &str, branch: &str) -> Result<String> {
    git::run(root, &["check-ref-format", &format!("refs/heads/{branch}")])?;
    let reference = provider::api(
        repo,
        &format!(
            "{endpoint}/git/ref/heads/{}",
            crate::change_url::encode(branch)
        ),
        None,
    )?;
    ensure!(
        reference["ref"] == format!("refs/heads/{branch}")
            && reference["object"]["type"] == "commit",
        "GitHub returned a different branch"
    );
    Ok(reference["object"]["sha"]
        .as_str()
        .filter(|oid| git::valid_oid(oid))
        .context("GitHub omitted the branch commit")?
        .to_owned())
}

fn pull(repo: &Path, url: &str) -> Result<Option<Acquisition>> {
    let repo = repo
        .canonicalize()
        .context("Cannot resolve the invocation directory")?;
    let expected = provider::identity(url)?;
    let (actual, base, head, _) = provider::resolve(&repo, &expected)?;
    if let Ok(local) = git::root(&repo)
        && git::revision(&local, &base).is_ok()
        && git::revision(&local, &head).is_ok()
    {
        return Ok(None);
    }
    let directory = tempfile::Builder::new()
        .prefix("change-review-source-")
        .tempdir()?;
    let root = directory.path().canonicalize()?;
    git::run(&root, &["init", "--quiet", "--template="])?;
    let remote = format!("https://github.com/{}/{}.git", actual.owner, actual.repo);
    fetch(&root, &remote, &[&base, &head])?;
    Ok(Some(Acquisition {
        directory,
        target: Target::Pull(actual.url),
        url: remote.trim_end_matches(".git").into(),
    }))
}

fn fetch(repo: &Path, url: &str, revisions: &[&str]) -> Result<()> {
    let mut arguments = vec![
        "-c",
        "fetch.fsckObjects=true",
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        "--no-recurse-submodules",
        "--depth=256",
        "--",
        url,
    ];
    arguments.extend_from_slice(revisions);
    git::run(repo, &arguments).context("Cannot acquire reviewed commits within the bounded fetch; no development refs were changed")?;
    Ok(())
}

pub fn root(acquired: &Acquisition) -> Result<PathBuf> {
    Ok(acquired.directory.path().canonicalize()?)
}
