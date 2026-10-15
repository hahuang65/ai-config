//! Git inventory and exclusive repository operation locks.
use crate::{Error, Result, process, text};
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{File, OpenOptions};
use std::os::fd::AsRawFd;
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

pub fn result(cwd: &Path, arguments: &[&str]) -> Result<process::Output> {
    let mut command = vec!["git", "--no-pager"];
    command.extend_from_slice(arguments);
    process::run(cwd, &command, false, 30)
}

pub fn git(cwd: &Path, arguments: &[&str]) -> Result<String> {
    let mut command = vec!["git", "--no-pager"];
    command.extend_from_slice(arguments);
    Ok(process::run(cwd, &command, true, 30)?.stdout.trim().into())
}

pub fn unchecked(cwd: &Path, arguments: &[&str]) -> Result<String> {
    Ok(result(cwd, arguments)?.stdout.trim().into())
}

pub fn config(cwd: &Path, key: &str) -> Result<String> {
    unchecked(cwd, &["config", "--get", key])
}

pub fn commit(cwd: &Path, reference: &str) -> Result<Option<String>> {
    let output = result(
        cwd,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{reference}^{{commit}}"),
        ],
    )?;
    Ok((output.code == 0).then(|| output.stdout.trim().into()))
}

pub fn ancestor(cwd: &Path, older: &str, newer: &str) -> Result<bool> {
    match result(cwd, &["merge-base", "--is-ancestor", older, newer])?.code {
        0 => Ok(true),
        1 => Ok(false),
        _ => Err(Error::new(
            "Could not compare commit history; cleanup stopped.",
        )),
    }
}

pub fn inventory(cwd: &Path) -> Result<Vec<BTreeMap<String, String>>> {
    let output = git(cwd, &["worktree", "list", "--porcelain", "-z"])?;
    let mut entries: Vec<_> = output
        .split("\0\0")
        .filter_map(|entry| {
            let fields: BTreeMap<_, _> = entry
                .split('\0')
                .filter(|line| !line.is_empty())
                .map(|line| {
                    let (key, value) = line.split_once(' ').unwrap_or((line, ""));
                    (key.into(), value.into())
                })
                .collect();
            fields.contains_key("worktree").then_some(fields)
        })
        .collect();
    resolve_main_checkout(cwd, &mut entries)?;
    Ok(entries)
}

fn resolve_main_checkout(cwd: &Path, entries: &mut [BTreeMap<String, String>]) -> Result<()> {
    let Some(first) = entries
        .first_mut()
        .filter(|entry| !entry.contains_key("bare"))
    else {
        return Ok(());
    };
    let common = git(
        cwd,
        &["rev-parse", "--path-format=absolute", "--git-common-dir"],
    )?;
    if first["worktree"] == common {
        // Git can report a submodule's administrative directory as its main worktree.
        // Resolve that entry in its own context, never from the current linked task.
        let checkout = git(&text::pathbuf(&common), &["rev-parse", "--show-toplevel"])?;
        first.insert("worktree".into(), checkout);
    }
    Ok(())
}

pub fn path(cwd: &Path, name: &str) -> Result<PathBuf> {
    Ok(text::pathbuf(&git(
        cwd,
        &["rev-parse", "--path-format=absolute", "--git-path", name],
    )?))
}

pub fn repository_lock(common: &Path) -> Result<File> {
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .custom_flags(libc::O_NOFOLLOW)
        .mode(0o600)
        .open(common.join("wt-operation.lock"))?;
    // SAFETY: lock is an open descriptor; flock neither owns nor outlives it.
    if unsafe { libc::flock(lock.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } != 0 {
        let error = std::io::Error::last_os_error();
        if error.kind() == std::io::ErrorKind::WouldBlock {
            return Err(Error::new(
                "Another wt operation is running for this repository. Retry when it finishes.",
            ));
        }
        return Err(error.into());
    }
    Ok(lock)
}

const MAX_BRANCH_NAMES: usize = 64;
const MAX_BRANCH_NAME_BYTES: usize = 1024;

// One repository in one CLI invocation; never retained across commands.
// Only successful, pure syntax checks are reused, not mutable Git evidence.
pub struct BranchNames {
    root: PathBuf,
    names: RefCell<BTreeSet<String>>,
}

impl BranchNames {
    pub fn new(root: &Path) -> Self {
        Self {
            root: root.to_owned(),
            names: RefCell::default(),
        }
    }

    pub fn valid(&self, name: &str) -> Result<bool> {
        self.validate(name, || {
            let output = result(
                &self.root,
                &["check-ref-format", &format!("refs/heads/{name}")],
            )?;
            Ok(output.code == 0)
        })
    }

    fn validate(&self, name: &str, check: impl FnOnce() -> Result<bool>) -> Result<bool> {
        if name.is_empty() || name.starts_with('-') || !text::encodable(name) {
            return Ok(false);
        }
        if process::interrupted() {
            return Err(Error::new("Interrupted"));
        }
        if self.names.borrow().contains(name) {
            return Ok(true);
        }
        let valid = check()?;
        if valid
            && name.len() <= MAX_BRANCH_NAME_BYTES
            && self.names.borrow().len() < MAX_BRANCH_NAMES
        {
            self.names.borrow_mut().insert(name.to_owned());
        }
        Ok(valid)
    }
}

#[cfg(test)]
#[path = "../tests/support/branch_names.rs"]
mod branch_name_tests;
