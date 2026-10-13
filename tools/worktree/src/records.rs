//! Worktree ownership records are evidence, never an inventory database.
use crate::{
    Error, Result, git,
    repository::{Repository, task_name},
    text,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::fs;
use std::path::Path;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Metadata {
    pub version: u64,
    pub path: String,
    pub task: String,
    pub branch: String,
    pub base: String,
    pub remote: Option<String>,
    pub delivery: String,
}

#[derive(Clone, PartialEq, Eq, Serialize)]
pub struct Entry {
    pub path: String,
    pub branch: String,
    pub task: String,
    pub base: String,
    pub managed: bool,
    pub locked: bool,
    #[serde(rename = "lockReason")]
    pub lock_reason: String,
    pub head: String,
    pub missing: bool,
}

impl Entry {
    pub fn identity(&self) -> Value {
        json!({"path": self.path, "task": self.task, "branch": self.branch, "base": self.base, "managed": self.managed})
    }
}

impl Repository {
    pub fn entries(&self) -> Result<Vec<Entry>> {
        git::inventory(&self.root)?
            .iter()
            .map(|entry| {
                let path = text::pathbuf(&entry["worktree"]);
                let metadata = self.metadata(&path)?;
                Ok(Entry {
                    path: entry["worktree"].clone(),
                    branch: entry
                        .get("branch")
                        .map(|branch| branch.strip_prefix("refs/heads/").unwrap_or(branch).into())
                        .unwrap_or_default(),
                    task: metadata
                        .as_ref()
                        .map(|record| record.task.clone())
                        .unwrap_or_else(|| text::from_os(path.file_name().unwrap_or_default())),
                    base: metadata
                        .as_ref()
                        .map(|record| record.base.clone())
                        .unwrap_or_else(|| self.base.clone()),
                    managed: metadata.is_some(),
                    locked: entry.contains_key("locked"),
                    lock_reason: entry.get("locked").cloned().unwrap_or_default(),
                    head: entry.get("HEAD").cloned().unwrap_or_default(),
                    missing: !path.is_dir(),
                })
            })
            .collect()
    }

    pub fn metadata(&self, path: &Path) -> Result<Option<Metadata>> {
        if path == self.root
            || path.parent() != Some(self.directory.as_path())
            || path.is_symlink()
            || !path.is_dir()
        {
            return Ok(None);
        }
        let owner = self.directory.join(".repository");
        if !owner.is_file()
            || owner.is_symlink()
            || text::decode(&fs::read(owner)?).trim() != text::path(&self.common)
        {
            return Ok(None);
        }
        let record =
            text::pathbuf(&git::git(path, &["rev-parse", "--absolute-git-dir"])?).join("wt.json");
        if record.is_symlink() {
            return Ok(None);
        }
        let Some(metadata) = read_metadata(&record) else {
            return Ok(None);
        };
        if metadata.version != 1
            || metadata.path != text::path(path)
            || Some(std::ffi::OsStr::new(&metadata.task)) != path.file_name()
            || !task_name(&metadata.task)
        {
            return Ok(None);
        }
        for name in [&metadata.branch, &metadata.base] {
            if !git::valid_branch(&self.root, name)? {
                return Ok(None);
            }
        }
        if !["local", "github"].contains(&metadata.delivery.as_str()) {
            return Ok(None);
        }
        Ok(Some(metadata))
    }

    pub fn selected(&self, task: &str) -> Result<Entry> {
        let mut matches: Vec<_> = self
            .entries()?
            .into_iter()
            .filter(|entry| entry.managed && entry.task == task)
            .collect();
        if matches.len() != 1 {
            return Err(Error::new(format!(
                "No managed worktree named {task}. Use wt list to see available tasks."
            )));
        }
        let entry = matches.pop().expect("one entry");
        let metadata = self.metadata(&text::pathbuf(&entry.path))?.ok_or_else(|| Error::new("The worktree changed during cleanup. Nothing was removed; retry after activity stops."))?;
        if entry.branch != metadata.branch {
            return Err(Error::new(
                "The worktree branch changed since creation. Restore its original branch before using wt.",
            ));
        }
        Ok(entry)
    }
}

fn read_metadata(path: &Path) -> Option<Metadata> {
    let value: Value = text::json(&text::decode(fs::read_to_string(path).ok()?.as_bytes())).ok()?;
    // Option fields normally accept missing keys; Python's record schema does not.
    if value.as_object()?.len() != 7 || value.get("remote").is_none() {
        return None;
    }
    serde_json::from_value(value).ok()
}
