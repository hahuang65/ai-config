use crate::paths::Result;
use std::path::{Path, PathBuf};

pub fn default_root(source: &Path) -> Result<PathBuf> {
    let source = source
        .canonicalize()
        .map_err(|_| "Cannot resolve review package source.")?;
    if !has_git_metadata(&source)? {
        return Ok(source.join(".state/reviews"));
    }
    verify_source_root(&source)?;
    let inventory = crate::state_git::run(&source, &["worktree", "list", "--porcelain", "-z"])?;
    let primary = inventory
        .split('\0')
        .next()
        .and_then(|line| line.strip_prefix("worktree "))
        .filter(|path| !path.is_empty())
        .ok_or("Cannot find the primary checkout for review state. Set AR_ROOT.")?;
    let common = git_common(&source)?;
    let primary = PathBuf::from(primary)
        .canonicalize()
        .map_err(|_| "Primary review checkout is unavailable. Set AR_ROOT.")?;
    // Git can list a submodule's administrative directory in place of its primary checkout.
    let primary = if primary == common {
        let output = crate::state_git::run(&common, &["rev-parse", "--show-toplevel"])?;
        PathBuf::from(output.strip_suffix('\n').unwrap_or(&output))
            .canonicalize()
            .map_err(|_| "Cannot resolve primary submodule checkout for review state.")?
    } else {
        primary
    };
    if git_common(&primary)? != common {
        return Err("Review state cannot cross Git repository identities. Set AR_ROOT explicitly.");
    }
    Ok(primary.join(".state/reviews"))
}

fn verify_source_root(source: &Path) -> Result<()> {
    let output = crate::state_git::run(source, &["rev-parse", "--show-toplevel"])?;
    let root = PathBuf::from(output.strip_suffix('\n').unwrap_or(&output))
        .canonicalize()
        .map_err(|_| "Cannot verify the review package worktree root. Set AR_ROOT explicitly.")?;
    if root != source {
        return Err("Git discovery escaped the review package source. Set AR_ROOT explicitly.");
    }
    Ok(())
}

fn has_git_metadata(source: &Path) -> Result<bool> {
    let path = source.join(".git");
    match std::fs::symlink_metadata(&path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(_) => Err("Cannot inspect review package Git identity. Set AR_ROOT explicitly."),
        Ok(_) => {
            std::fs::metadata(path).map_err(
                |_| "Review package Git metadata is unavailable. Set AR_ROOT explicitly.",
            )?;
            Ok(true)
        }
    }
}

fn git_common(source: &Path) -> Result<PathBuf> {
    let output = crate::state_git::run(
        source,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    PathBuf::from(output.strip_suffix('\n').unwrap_or(&output))
        .canonicalize()
        .map_err(|_| "Cannot resolve review package Git directory.")
}

#[cfg(test)]
#[path = "../tests/support/state_root.rs"]
mod tests;
