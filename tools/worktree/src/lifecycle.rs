//! Explicit creation and conservative removal; never commit or publish.
use crate::{
    Error, Result,
    cleanup_proof::Proof,
    git,
    records::{Entry, Metadata},
    repository::Repository,
    text,
};
use serde_json::{Value, json};
use std::fs;
use std::io::Write;
use std::path::Path;

pub const INVENTORY_LIMIT: usize = 50;

pub fn outcome(
    repo: &Repository,
    command: &str,
    entry: Option<&Entry>,
    kind: &str,
    target: &Path,
) -> Value {
    let mut result = json!({"protocolVersion": 1, "command": command, "project": repo.summary(),
        "transition": {"kind": kind, "targetPath": text::path(target)}});
    if let Some(entry) = entry {
        result["worktree"] = entry.identity();
    }
    result
}

pub fn list(repo: &Repository, all: bool) -> Result<Value> {
    let mut entries = repo.entries()?;
    let total = entries.len();
    if !all {
        entries.truncate(INVENTORY_LIMIT);
    }
    let mut result = outcome(repo, "list", None, "none", &repo.cwd);
    result["worktrees"] = json!(entries);
    result["total"] = json!(total);
    result["omitted"] = json!(total - entries.len());
    Ok(result)
}

fn reminder(repo: &Repository) -> Result<Value> {
    let entries = repo.entries()?;
    eprintln!("Existing worktrees:");
    for entry in entries.iter().take(INVENTORY_LIMIT) {
        let kind = if entry.managed { "task" } else { "unmanaged" };
        let branch = if entry.branch.is_empty() {
            "detached"
        } else {
            &entry.branch
        };
        text::diagnostic(&format!(
            "  {} [{kind}, {branch}] {}",
            entry.task, entry.path
        ));
    }
    let omitted = entries.len().saturating_sub(INVENTORY_LIMIT);
    if omitted > 0 {
        eprintln!("  {omitted} more. Run wt list --all.");
    }
    Ok(
        json!({"worktrees": entries.iter().take(INVENTORY_LIMIT).map(Entry::identity).collect::<Vec<_>>(), "omitted": omitted}),
    )
}

pub fn new(repo: &Repository, task: &str, base: Option<&str>, local: bool) -> Result<Value> {
    let existing = reminder(repo)?;
    let target = repo.directory.join(task);
    if target.exists() || target.is_symlink() {
        return Err(Error::new(
            "The task directory already exists. Use wt enter TASK or choose another name.",
        ));
    }
    let branch = branch_name(repo, task)?;
    let delivery = repo.delivery()?;
    let start = repo.starting_commit(base, local)?;
    repo.claim_directory()?;
    git::git(
        &repo.root,
        &[
            "worktree",
            "add",
            "--no-track",
            "-b",
            &branch,
            &text::path(&target),
            &start,
        ],
    )?;
    let metadata = Metadata {
        version: 1,
        task: task.into(),
        path: text::path(&target),
        branch,
        base: repo.base.clone(),
        remote: repo.remote.clone(),
        delivery,
    };
    let record = git::path(&target, "wt.json")?;
    if save_record(&record, &metadata).is_err() {
        return Err(Error::new(format!(
            "Worktree created at {}, but its wt record could not be saved. It remains visible as unmanaged; inspect it before retrying.",
            text::path(&target)
        )));
    }
    let mut result = outcome(repo, "new", None, "enter-worktree", &target);
    result["worktree"] = json!({"path": metadata.path, "task": metadata.task, "branch": metadata.branch, "base": metadata.base, "managed": true});
    result["inventory"] = existing;
    Ok(result)
}

fn branch_name(repo: &Repository, task: &str) -> Result<String> {
    let configured = git::config(&repo.root, "wt.initials")?;
    let initials = if configured.is_empty() {
        git::config(&repo.root, "user.name")?
            .split_whitespace()
            .filter_map(|word| word.chars().next())
            .collect::<String>()
            .to_lowercase()
    } else {
        configured
    };
    if initials.is_empty() || !initials.bytes().all(|byte| byte.is_ascii_alphanumeric()) {
        return Err(Error::new(
            "Set git config wt.initials INITIALS before creating a task.",
        ));
    }
    let branch = format!("{initials}/{task}");
    if git::result(
        &repo.root,
        &[
            "show-ref",
            "--verify",
            "--quiet",
            &format!("refs/heads/{branch}"),
        ],
    )?
    .code
        == 0
    {
        return Err(Error::new(
            "The task branch already exists. Choose another task name; wt never resets a branch.",
        ));
    }
    Ok(branch)
}

fn save_record(path: &Path, metadata: &Metadata) -> Result<()> {
    let mut stream = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    let record = serde_json::to_string(metadata).map_err(|error| Error::new(error.to_string()))?;
    stream.write_all(text::ascii_json(&record).as_bytes())?;
    Ok(())
}

pub fn enter(repo: &Repository, task: &str) -> Result<Value> {
    let entry = repo.selected(task)?;
    if entry.locked {
        return Err(Error::new(
            "This worktree is locked by Git. Inspect its reason before changing that protection.",
        ));
    }
    Ok(outcome(
        repo,
        "enter",
        Some(&entry),
        "enter-worktree",
        &text::pathbuf(&entry.path),
    ))
}

fn current_inside(repo: &Repository, entry: &Entry) -> bool {
    repo.cwd.starts_with(text::pathbuf(&entry.path))
}

fn validate_clean(repo: &Repository, task: &str) -> Result<(Entry, Metadata, String, Proof)> {
    let entry = repo.selected(task)?;
    let path = &text::pathbuf(&entry.path);
    if entry.locked {
        return Err(Error::new(
            "This worktree is locked by Git. Inspect its reason before changing that protection.",
        ));
    }
    validate_status(path)?;
    let metadata = repo.metadata(path)?.ok_or_else(|| {
        Error::new(
            "The worktree changed during cleanup. Nothing was removed; retry after activity stops.",
        )
    })?;
    let head = git::commit(path, "HEAD")?
        .ok_or_else(|| Error::new("The task has no valid commit. Cleanup stopped."))?;
    let proof = Proof::obtain(repo, &metadata, &head)?;
    Ok((entry, metadata, head, proof))
}

fn validate_status(path: &Path) -> Result<()> {
    if !git::git(
        path,
        &[
            "status",
            "--porcelain=v1",
            "--untracked-files=all",
            "--ignore-submodules=none",
        ],
    )?
    .is_empty()
    {
        return Err(Error::new(
            "The worktree has modified tracked or non-ignored untracked files. Save them before cleanup.",
        ));
    }
    for marker in [
        "rebase-merge",
        "rebase-apply",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "BISECT_LOG",
    ] {
        if git::path(path, marker)?.exists() {
            return Err(Error::new(
                "A Git operation is still in progress in this worktree. Finish it before cleanup.",
            ));
        }
    }
    Ok(())
}

fn clean_one(repo: &Repository, task: &str, check: bool) -> Result<Value> {
    let (entry, metadata, head, proof) = validate_clean(repo, task)?;
    let inside = current_inside(repo, &entry);
    let mut result = outcome(
        repo,
        "clean",
        Some(&entry),
        if inside { "return-main" } else { "none" },
        if inside { &repo.root } else { &repo.cwd },
    );
    result["proof"] = json!(proof.description);
    result["removed"] = json!(false);
    if check || inside {
        return Ok(result);
    }
    proof.recheck(repo, &metadata, &head)?;
    // Git rechecks dirtiness and locks during removal. Never use --force.
    if repo.selected(task)? != entry
        || git::commit(&text::pathbuf(&entry.path), "HEAD")?.as_deref() != Some(&head)
    {
        return Err(Error::new(
            "The worktree changed during cleanup. Nothing was removed; retry after activity stops.",
        ));
    }
    validate_status(&text::pathbuf(&entry.path))?;
    git::git(&repo.root, &["worktree", "remove", &entry.path])?;
    result["removed"] = json!(true);
    match remove_branch(repo, &entry, &metadata, &head, &proof) {
        Ok(removed) => {
            result["branchRemoved"] = json!(removed);
            if !removed {
                result["branchReason"] =
                    json!("The exact branch tip is not integrated into the local target branch.");
            }
        }
        Err(error) => {
            result["branchRemoved"] = json!(false);
            result["branchReason"] = json!(error.to_string());
            result["cleanupIncomplete"] = json!(true);
        }
    }
    Ok(result)
}

fn remove_branch(
    repo: &Repository,
    entry: &Entry,
    metadata: &Metadata,
    head: &str,
    proof: &Proof,
) -> Result<bool> {
    let reference = format!("refs/heads/{}", entry.branch);
    if git::commit(&repo.root, &reference)?.as_deref() != Some(head) {
        return Err(Error::new(
            "The task branch changed during cleanup. Inspect it before deleting it.",
        ));
    }
    if !proof.permits_branch(repo, metadata, head)? {
        return Ok(false);
    }
    // Unlike branch -d, use the recorded target rather than an unrelated upstream.
    // Check Git's checkout protection, then compare-and-delete the proven exact tip.
    if git::inventory(&repo.root)?
        .iter()
        .any(|item| item.get("branch") == Some(&reference))
    {
        return Err(Error::new(
            "The task branch is checked out elsewhere. Branch retained.",
        ));
    }
    git::git(&repo.root, &["update-ref", "-d", &reference, head])?;
    remove_branch_config(repo, entry);
    Ok(true)
}

fn remove_branch_config(repo: &Repository, entry: &Entry) {
    match git::result(
        &repo.root,
        &[
            "config",
            "--local",
            "--remove-section",
            &format!("branch.{}", entry.branch),
        ],
    ) {
        Ok(output) if output.code == 0 || output.code == 128 => {} // No section is normal.
        _ => eprintln!(
            "wt: Local branch deleted, but its optional Git configuration could not be removed."
        ),
    }
}

pub fn clean(repo: &Repository, task: Option<&str>, check: bool) -> Result<Value> {
    if let Some(task) = task {
        return clean_one(repo, task, check);
    }
    let mut results = Vec::new();
    for entry in repo.entries()?.into_iter().filter(|entry| entry.managed) {
        let result = match clean_one(repo, &entry.task, check) {
            Ok(result) => result,
            Err(error) => {
                if crate::process::interrupted() || matches!(error, Error::Io(_)) {
                    return Err(error);
                }
                json!({"worktree": entry.identity(), "removed": false, "reason": error.to_string()})
            }
        };
        results.push(result);
    }
    let mut result = outcome(repo, "clean", None, "none", &repo.cwd);
    result["results"] = json!(results);
    Ok(result)
}
