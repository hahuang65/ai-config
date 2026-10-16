//! Human-readable labels are captured with the review, not resolved when an old report opens.
use crate::{
    change_args::Target,
    change_git as git,
    change_types::{Scope, ScopeDisplay},
};
use anyhow::Result;
use std::path::{Path, PathBuf};

pub fn describe(
    repo: &Path,
    requested: &Target,
    selected: &Target,
    scope: &Scope,
) -> Result<ScopeDisplay> {
    if let Some(pr) = &scope.pull_request {
        return Ok(ScopeDisplay {
            repository: pr.repo.clone(),
            comparison: format!("Pull request #{} changes", pr.number),
        });
    }
    if let Target::Github(url) = requested
        && let crate::change_url::Subject::Branch { repository, branch } =
            crate::change_url::parse(url)?
    {
        return Ok(ScopeDisplay {
            repository: repository.rsplit('/').next().unwrap_or("Repository").into(),
            comparison: format!(
                "Default branch → {}",
                branch.as_deref().unwrap_or("default branch")
            ),
        });
    }
    Ok(ScopeDisplay {
        repository: repository_name(repo)?,
        comparison: comparison(repo, selected)?,
    })
}

fn comparison(repo: &Path, selected: &Target) -> Result<String> {
    Ok(match selected {
        Target::Expression(expression) => {
            let (base, head) = expression.split_once("..").unwrap_or(("HEAD", "HEAD"));
            format!("{} → {}", reference(repo, base), reference(repo, head))
        }
        Target::Range(base, head) => {
            format!("{} → {}", reference(repo, base), reference(repo, head))
        }
        Target::Local => format!("{} → working changes", current(repo)),
        Target::Branch(branch) => format!("{} → {}", trunk(repo)?, reference(repo, branch)),
        Target::Current | Target::Working { .. } => {
            let name = match selected {
                Target::Working {
                    branch: Some(branch),
                    ..
                } => reference(repo, branch),
                Target::Working { branch: None, .. } => format!("worktree {}", basename(repo)),
                _ => current(repo),
            };
            format!("{} → {name} + outstanding changes", trunk(repo)?)
        }
        _ => "Selected changes".into(),
    })
}

fn repository_name(repo: &Path) -> Result<String> {
    let raw = git::run(
        repo,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    let common = PathBuf::from(std::str::from_utf8(&raw)?.trim_end_matches('\n'));
    let primary = if common.file_name().is_some_and(|name| name == ".git") {
        common.parent().unwrap_or(&common)
    } else {
        &common
    };
    Ok(basename(primary).trim_end_matches(".git").into())
}

fn basename(path: &Path) -> &str {
    path.file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Repository")
}

fn trunk(repo: &Path) -> Result<String> {
    Ok(reference(repo, &crate::change_subject::trunk_name(repo)?))
}

fn current(repo: &Path) -> String {
    git::run(repo, &["symbolic-ref", "--quiet", "--short", "HEAD"])
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .map(|name| name.trim_end_matches('\n').to_owned())
        .unwrap_or_else(|| "current checkout".into())
}

fn reference(repo: &Path, name: &str) -> String {
    if name.is_empty() || name == "HEAD" {
        return current(repo);
    }
    let name = name
        .strip_prefix("refs/heads/")
        .or_else(|| name.strip_prefix("refs/remotes/"))
        .unwrap_or(name);
    if git::valid_oid(name) {
        name[..12].into()
    } else {
        name.into()
    }
}
