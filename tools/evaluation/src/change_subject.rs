//! Resolve human subjects without changing the selected repository's refs or index.
use crate::{change_args::Target, change_git as git};
use anyhow::{Result, bail, ensure};
use std::path::{Path, PathBuf};

struct Worktree {
    path: PathBuf,
    branch: Option<String>,
    head: Option<String>,
}

fn worktrees(repo: &Path) -> Result<Vec<Worktree>> {
    let output = git::run(repo, &["worktree", "list", "--porcelain", "-z"])?;
    let mut result = Vec::<Worktree>::new();
    for field in std::str::from_utf8(&output)?.split('\0') {
        if let Some(path) = field.strip_prefix("worktree ") {
            result.push(Worktree {
                path: path.into(),
                branch: None,
                head: None,
            });
        } else if let Some(branch) = field.strip_prefix("branch ")
            && let Some(worktree) = result.last_mut()
        {
            worktree.branch = Some(branch.into());
        } else if let Some(head) = field.strip_prefix("HEAD ")
            && let Some(worktree) = result.last_mut()
        {
            worktree.head = Some(head.into());
        }
    }
    Ok(result)
}

pub struct Selection {
    pub repo: PathBuf,
    pub target: Target,
    pub remote_url: Option<String>,
    _acquired: Option<crate::change_remote::Acquisition>,
}

pub fn resolve(repo: &Path, target: &Target) -> Result<Selection> {
    if let Target::Github(url) = target {
        if let Some(acquired) = crate::change_remote::acquire(repo, url)? {
            return Ok(Selection {
                repo: crate::change_remote::root(&acquired)?,
                target: acquired.target.clone(),
                remote_url: Some(acquired.url.clone()),
                _acquired: Some(acquired),
            });
        }
        return Ok(Selection {
            repo: git::root(repo)?,
            target: match crate::change_url::parse(url)? {
                crate::change_url::Subject::Pull(identity) => Target::Pull(identity.url),
                _ => anyhow::bail!("Remote branch acquisition did not complete"),
            },
            remote_url: None,
            _acquired: None,
        });
    }
    let (repo, target) = local(&git::root(repo)?, target)?;
    Ok(Selection {
        repo,
        target,
        remote_url: None,
        _acquired: None,
    })
}

fn local(repo: &Path, target: &Target) -> Result<(PathBuf, Target)> {
    let Target::Branch(subject) = target else {
        return Ok((repo.into(), target.clone()));
    };
    let branch = branch(repo, subject)?;
    let worktrees = worktrees(repo)?;
    let candidates: Vec<_> = worktrees
        .iter()
        .filter(|tree| {
            if let Some(branch) = &branch {
                tree.branch.as_ref() == Some(branch)
            } else {
                tree.path
                    .file_name()
                    .is_some_and(|name| name == subject.as_str())
                    || tree.path == Path::new(subject)
                    || tree.path == repo.join(subject)
            }
        })
        .collect();
    ensure!(
        candidates.len() <= 1,
        "Ambiguous worktree subject; use an exact branch or worktree path"
    );
    if let Some(tree) = candidates.first() {
        return selected_worktree(repo, tree);
    }
    let branch = branch
        .ok_or_else(|| anyhow::anyhow!("Unknown branch or worktree; use an exact name or X..Y"))?;
    Ok((repo.into(), Target::Branch(branch)))
}

fn branch(repo: &Path, subject: &str) -> Result<Option<String>> {
    let refs = git::run(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)",
            "refs/heads/",
            "refs/remotes/",
        ],
    )?;
    let refs: Vec<_> = std::str::from_utf8(&refs)?.lines().collect();
    Ok([
        subject.to_owned(),
        format!("refs/heads/{subject}"),
        format!("refs/remotes/{subject}"),
    ]
    .into_iter()
    .find(|candidate| refs.contains(&candidate.as_str())))
}

fn selected_worktree(repo: &Path, tree: &Worktree) -> Result<(PathBuf, Target)> {
    let selected = git::root(&tree.path)?;
    let common = |path: &Path| -> Result<PathBuf> {
        let raw = git::run(
            path,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?;
        Ok(PathBuf::from(std::str::from_utf8(&raw)?.trim_end_matches('\n')).canonicalize()?)
    };
    ensure!(
        common(repo)? == common(&selected)?,
        "Selected worktree no longer belongs to this repository"
    );
    let target = Target::Working {
        head: tree
            .head
            .clone()
            .filter(|oid| git::valid_oid(oid))
            .ok_or_else(|| anyhow::anyhow!("Invalid selected worktree HEAD"))?,
        branch: tree.branch.clone(),
    };
    verify(&selected, &target)?;
    Ok((selected, target))
}

pub fn verify(repo: &Path, target: &Target) -> Result<()> {
    if let Target::Working { head, branch } = target {
        ensure!(
            git::revision(repo, "HEAD")? == *head,
            "Selected worktree changed; retry the review"
        );
        let actual = git::run(repo, &["rev-parse", "--symbolic-full-name", "HEAD"])?;
        ensure!(
            std::str::from_utf8(&actual)?.trim_end_matches('\n')
                == branch.as_deref().unwrap_or("HEAD"),
            "Selected worktree changed; retry the review"
        );
    }
    Ok(())
}

pub fn trunk(repo: &Path) -> Result<String> {
    git::revision(repo, &trunk_name(repo)?)
}

pub fn trunk_name(repo: &Path) -> Result<String> {
    let output = git::run(
        repo,
        &[
            "for-each-ref",
            "--format=%(refname)%09%(symref)",
            "refs/remotes/",
        ],
    )?;
    let defaults: Vec<_> = std::str::from_utf8(&output)?
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .filter(|(name, target)| name.ends_with("/HEAD") && !target.is_empty())
        .collect();
    if let Some((_, target)) = defaults
        .iter()
        .find(|(name, _)| *name == "refs/remotes/origin/HEAD")
    {
        return Ok((*target).to_owned());
    }
    ensure!(
        defaults.len() <= 1,
        "Multiple remote default branches; use an explicit X..Y range"
    );
    if let Some((_, target)) = defaults.first() {
        return Ok((*target).to_owned());
    }
    let mut candidates = Vec::new();
    for name in ["refs/heads/main", "refs/heads/master"] {
        let output = git::run(repo, &["for-each-ref", "--format=%(refname)", name])?;
        if !output.is_empty() {
            candidates.push(name);
        }
    }
    match candidates.as_slice() {
        [name] => Ok((*name).to_owned()),
        [] => bail!("Cannot identify trunk; set the remote default branch or use X..Y"),
        _ => bail!("Both main and master exist without a remote default; use X..Y"),
    }
}

pub fn merge_base(repo: &Path, base: &str, head: &str) -> Result<String> {
    let output = git::run(repo, &["merge-base", "--all", base, head])?;
    let oid = std::str::from_utf8(&output)?.trim().to_owned();
    ensure!(
        git::valid_oid(&oid),
        "A unique merge base is required; fetch complete commit history"
    );
    Ok(oid)
}
