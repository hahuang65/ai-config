//! Explicit creation and conservative removal; never commit or publish.
use crate::{
    Error, Result, git, github,
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
            "This worktree is locked, possibly by another Pi session. Resume its existing tab instead.",
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

fn own_check_lock(repo: &Repository, entry: &Entry, check: bool) -> bool {
    let owner = std::env::var("WT_SESSION_PID").unwrap_or_default();
    if !check
        || !current_inside(repo, entry)
        || owner.is_empty()
        || entry.lock_reason != format!("wt-pi:{owner}")
    {
        return false;
    }
    let Some(pid) = session_pid(&owner) else {
        return false;
    };
    // SAFETY: signal zero only probes process existence/permission, never signals it.
    unsafe { libc::kill(pid, 0) == 0 }
}

fn session_pid(owner: &str) -> Option<libc::pid_t> {
    // Unicode decimal zeroes in Python 3.11's Unicode 14 database.
    const ZEROES: &[u32] = &[
        0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66,
        0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90,
        0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0,
        0xff10, 0x104a0, 0x10d30, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0,
        0x11650, 0x116c0, 0x11730, 0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0, 0x16a60, 0x16ac0,
        0x16b50, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6, 0x1e140, 0x1e2f0, 0x1e950, 0x1fbf0,
    ];
    owner.chars().try_fold(0_i32, |pid, character| {
        let digit = ZEROES.iter().find_map(|zero| {
            (character as u32)
                .checked_sub(*zero)
                .filter(|digit| *digit < 10)
        })?;
        pid.checked_mul(10)?.checked_add(digit as i32)
    })
}

fn validate_clean(repo: &Repository, task: &str, check: bool) -> Result<(Entry, String, String)> {
    let entry = repo.selected(task)?;
    let path = &text::pathbuf(&entry.path);
    if entry.locked && !own_check_lock(repo, &entry, check) {
        return Err(Error::new(
            "The worktree is locked. Close its Pi session first. Stale locks require manual review.",
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
    let proof = if metadata.delivery == "github" {
        format!(
            "merged pull request #{}",
            github::merged_pull_request(repo, &metadata, &head)?
        )
    } else {
        local_proof(repo, &metadata, &head)?
    };
    Ok((entry, head, proof))
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

fn local_proof(repo: &Repository, metadata: &Metadata, head: &str) -> Result<String> {
    if let Some(integrated) = git::commit(&repo.root, &format!("refs/heads/{}", metadata.base))?
        && git::ancestor(&repo.root, head, &integrated)?
    {
        return Ok(format!("integrated into {}", metadata.base));
    }
    Err(Error::new(
        "The exact task tip is not integrated into the local target branch. Worktree retained.",
    ))
}

fn clean_one(repo: &Repository, task: &str, check: bool) -> Result<Value> {
    let (entry, head, proof) = validate_clean(repo, task, check)?;
    let inside = current_inside(repo, &entry);
    let mut result = outcome(
        repo,
        "clean",
        Some(&entry),
        if inside { "return-main" } else { "none" },
        if inside { &repo.root } else { &repo.cwd },
    );
    result["proof"] = json!(proof);
    result["removed"] = json!(false);
    if check || inside {
        return Ok(result);
    }
    // Git rechecks dirtiness and locks during removal. Never use --force.
    if repo.selected(task)? != entry
        || git::commit(&text::pathbuf(&entry.path), "HEAD")?.as_deref() != Some(&head)
    {
        return Err(Error::new(
            "The worktree changed during cleanup. Nothing was removed; retry after activity stops.",
        ));
    }
    git::git(&repo.root, &["worktree", "remove", &entry.path])?;
    result["removed"] = json!(true);
    Ok(result)
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
