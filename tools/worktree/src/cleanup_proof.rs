//! Exact ancestry or merged-PR evidence for cleanup, without advancing branches.
use crate::{Error, Result, git, github, process, records::Metadata, repository::Repository};

pub struct Proof {
    pub description: String,
    synchronized: Option<SynchronizedTarget>,
}

impl Proof {
    pub fn obtain(repo: &Repository, metadata: &Metadata, head: &str) -> Result<Self> {
        let integrated = locally_integrated(repo, metadata, head)?;
        if metadata.delivery != "github" && integrated {
            return Ok(Self {
                description: format!("integrated into {}", metadata.base),
                synchronized: None,
            });
        }
        let number = github::merged_pull_request(repo, metadata, head).map_err(|error| match error {
            Error::Operational(message) if metadata.delivery != "github" => Error::new(format!(
                "The exact task tip is not integrated into the local target branch. {message}"
            )),
            other => other,
        })?;
        let synchronized = if metadata.delivery != "github" {
            Some(SynchronizedTarget::obtain(repo, metadata, head)?)
        } else if !integrated {
            SynchronizedTarget::optional(repo, metadata, head)?
        } else {
            None
        };
        Ok(Self {
            description: format!("merged pull request #{number}"),
            synchronized,
        })
    }

    pub fn recheck(&self, repo: &Repository, metadata: &Metadata, head: &str) -> Result<()> {
        if let Some(target) = &self.synchronized {
            target.recheck(repo, metadata, head)?;
        }
        Ok(())
    }

    pub fn permits_branch(
        &self,
        repo: &Repository,
        metadata: &Metadata,
        head: &str,
    ) -> Result<bool> {
        if self.synchronized.is_some() {
            self.recheck(repo, metadata, head)?;
            return Ok(true);
        }
        locally_integrated(repo, metadata, head)
    }
}

fn locally_integrated(repo: &Repository, metadata: &Metadata, head: &str) -> Result<bool> {
    match git::commit(&repo.root, &format!("refs/heads/{}", metadata.base))? {
        Some(target) => git::ancestor(&repo.root, head, &target),
        None => Ok(false),
    }
}

struct SynchronizedTarget {
    tip: String,
}

impl SynchronizedTarget {
    // Preserve GitHub's existing worktree-only cleanup when local proof is absent.
    fn optional(repo: &Repository, metadata: &Metadata, head: &str) -> Result<Option<Self>> {
        match Self::obtain(repo, metadata, head) {
            Ok(target) => Ok(Some(target)),
            Err(error) if process::interrupted() || matches!(error, Error::Io(_)) => Err(error),
            Err(_) => Ok(None),
        }
    }

    fn obtain(repo: &Repository, metadata: &Metadata, head: &str) -> Result<Self> {
        let tip = git::commit(&repo.root, &format!("refs/heads/{}", metadata.base))?
            .ok_or_else(|| Error::new("Restore the local integration branch before cleanup."))?;
        let target = Self { tip };
        target.recheck(repo, metadata, head)?;
        Ok(target)
    }

    fn recheck(&self, repo: &Repository, metadata: &Metadata, head: &str) -> Result<()> {
        let remote = metadata
            .remote
            .as_deref()
            .ok_or_else(|| Error::new("Merged-PR branch cleanup requires a configured remote."))?;
        if !self.matching_refs(repo, metadata, remote)? {
            return Err(Error::new(
                "Synchronize the local integration branch with its remote-tracking branch before cleanup.",
            ));
        }
        let tree = |tip: &str| {
            git::git(
                &repo.root,
                &["rev-parse", "--verify", &format!("{tip}^{{tree}}")],
            )
        };
        if tree(head)? != tree(&self.tip)? {
            return Err(Error::new(
                "The task tree differs from the synchronized integration branch.",
            ));
        }
        let reference = format!("refs/heads/{}", metadata.base);
        let advertised = git::git(
            &repo.root,
            &["ls-remote", "--exit-code", "--", remote, &reference],
        )?;
        let expected = format!("{}\t{reference}", self.tip);
        if advertised != expected || !self.matching_refs(repo, metadata, remote)? {
            return Err(Error::new(
                "The remote integration branch changed. Fetch and synchronize it before cleanup.",
            ));
        }
        Ok(())
    }

    fn matching_refs(&self, repo: &Repository, metadata: &Metadata, remote: &str) -> Result<bool> {
        let local = git::commit(&repo.root, &format!("refs/heads/{}", metadata.base))?;
        let tracking = git::commit(
            &repo.root,
            &format!("refs/remotes/{remote}/{}", metadata.base),
        )?;
        Ok(local.as_deref() == Some(&self.tip) && tracking.as_deref() == Some(&self.tip))
    }
}
