//! Repository identity and integration branch selection.
use crate::{Error, Result, git, process, text};
use serde_json::{Value, json};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

pub const TASK_ERROR: &str = "TASK must contain 1–64 letters, digits, underscores, or hyphens and start with a letter or digit.";

pub fn task_name(value: &str) -> bool {
    (1..=64).contains(&value.len())
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
}

pub struct Repository {
    pub cwd: PathBuf,
    pub common: PathBuf,
    pub root: PathBuf,
    pub worktree_root: PathBuf,
    pub name: String,
    pub directory: PathBuf,
    pub remote: Option<String>,
    pub base: String,
}

impl Repository {
    pub fn new(cwd: &Path) -> Result<Self> {
        let cwd = cwd.canonicalize()?;
        let common = text::pathbuf(&git::git(
            &cwd,
            &["rev-parse", "--path-format=absolute", "--git-common-dir"],
        )?);
        let entries = git::inventory(&cwd)?;
        let first = entries
            .first()
            .filter(|entry| !entry.contains_key("bare"))
            .ok_or_else(|| Error::new("Run wt inside a non-bare Git repository."))?;
        let root = resolve(&text::pathbuf(&first["worktree"]))?;
        let home = home()?;
        if root == resolve(&home.join(".dotfiles"))? {
            return Err(Error::new(
                "The dotfiles parent is not a task repository. Run wt inside the affected submodule.",
            ));
        }
        if !root.is_dir() {
            return Err(Error::new(
                "The main checkout is missing. Restore it before using wt.",
            ));
        }
        let worktree_root = worktree_root(&cwd, &home)?;
        let configured = git::config(&root, "wt.project")?;
        let name = if configured.is_empty() {
            text::from_os(root.file_name().unwrap_or_default())
        } else {
            configured
        };
        if !task_name(&name) {
            return Err(Error::new(
                "Set git config wt.project to a short, safe project name.",
            ));
        }
        let directory = worktree_root.join(&name);
        let remote = find_remote(&root)?;
        let base = find_base(&root, remote.as_deref())?;
        Ok(Self {
            cwd,
            common,
            root,
            worktree_root,
            name,
            directory,
            remote,
            base,
        })
    }

    pub fn summary(&self) -> Value {
        json!({"root": text::path(&self.root), "name": self.name, "base": self.base})
    }

    pub fn claim_directory(&self) -> Result<()> {
        fs::create_dir_all(&self.worktree_root)?;
        if self.directory.is_symlink() {
            return Err(Error::new(
                "The project worktree directory must not be a symlink.",
            ));
        }
        match fs::create_dir(&self.directory) {
            Err(error)
                if error.kind() == std::io::ErrorKind::AlreadyExists && self.directory.is_dir() => {
            }
            outcome => outcome?,
        }
        let owner = self.directory.join(".repository");
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&owner)
        {
            Ok(mut stream) => {
                stream.write_all(&text::encode(&format!("{}\n", text::path(&self.common))))?
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if owner.is_symlink()
                    || text::decode(&fs::read(owner)?).trim() != text::path(&self.common)
                {
                    return Err(Error::new(
                        "Another repository owns this worktree directory. Set a unique git config wt.project NAME.",
                    ));
                }
            }
            Err(error) => return Err(error.into()),
        }
        Ok(())
    }

    pub fn fetch(&self) -> Result<()> {
        if let Some(remote) = &self.remote {
            let refspec = format!(
                "refs/heads/{}:refs/remotes/{remote}/{}",
                self.base, self.base
            );
            if process::run(
                &self.root,
                &["git", "fetch", "--no-tags", remote, &refspec],
                false,
                90,
            )?
            .code
                != 0
            {
                return Err(Error::new(
                    "Could not fetch the integration branch. Fix remote access or explicitly use wt new TASK --local.",
                ));
            }
        }
        Ok(())
    }

    pub fn starting_commit(&self, override_base: Option<&str>, local: bool) -> Result<String> {
        if !local {
            self.fetch()?;
        }
        if let Some(reference) = override_base.filter(|value| !value.is_empty()) {
            return git::commit(&self.root, reference)?.ok_or_else(|| Error::new("The requested base does not resolve to a local commit. Fetch it explicitly, then retry."));
        }
        let local_tip = git::commit(&self.root, &format!("refs/heads/{}", self.base))?;
        let remote_tip = match (&self.remote, local) {
            (Some(remote), false) => {
                git::commit(&self.root, &format!("refs/remotes/{remote}/{}", self.base))?
            }
            _ => None,
        };
        match (local_tip, remote_tip) {
            (Some(local), Some(remote)) => {
                if git::ancestor(&self.root, &local, &remote)? {
                    return Ok(remote);
                }
                if git::ancestor(&self.root, &remote, &local)? {
                    return Ok(local);
                }
                Err(Error::new(
                    "Local and remote integration branches have diverged. Resolve this or choose an explicit --base.",
                ))
            }
            (Some(tip), None) | (None, Some(tip)) => Ok(tip),
            _ => Err(Error::new(
                "The integration branch has no commit. Create the initial project commit before starting a task.",
            )),
        }
    }

    pub fn delivery(&self) -> Result<String> {
        let explicit = git::config(&self.root, "wt.delivery")?;
        if !explicit.is_empty() {
            if !["local", "github"].contains(&explicit.as_str()) {
                return Err(Error::new("wt.delivery must be local or github."));
            }
            return Ok(explicit);
        }
        let mut family = String::new();
        for scope in ["--system", "--global"] {
            let output = git::result(
                &self.root,
                &["config", scope, "--includes", "--get", "ai.projectFamily"],
            )?;
            if output.code == 0 {
                family = output.stdout.trim().into();
            }
        }
        Ok(if family == "a5" { "github" } else { "local" }.into())
    }
}

fn find_remote(root: &Path) -> Result<Option<String>> {
    let remotes = git::git(root, &["remote"])?;
    let remotes: Vec<_> = remotes.lines().collect();
    let configured = git::config(root, "wt.remote")?;
    if !configured.is_empty() {
        if !remotes.contains(&configured.as_str()) {
            return Err(Error::new("Configured wt.remote does not exist."));
        }
        return Ok(Some(configured));
    }
    if remotes.contains(&"origin") {
        return Ok(Some("origin".into()));
    }
    if remotes.len() <= 1 {
        return Ok(remotes.first().map(|name| (*name).into()));
    }
    Err(Error::new(
        "Several remotes exist. Select the integration remote with git config wt.remote NAME.",
    ))
}

fn find_base(root: &Path, remote: Option<&str>) -> Result<String> {
    let configured = git::config(root, "wt.base")?;
    let base = if !configured.is_empty() {
        configured
    } else if let Some(remote) = remote {
        let symbolic = git::unchecked(
            root,
            &[
                "symbolic-ref",
                "--quiet",
                &format!("refs/remotes/{remote}/HEAD"),
            ],
        )?;
        symbolic.strip_prefix(&format!("refs/remotes/{remote}/")).ok_or_else(|| Error::new("The remote default branch is unknown. Run git remote set-head REMOTE -a or set git config wt.base BRANCH."))?.into()
    } else {
        let mut candidates = Vec::new();
        for branch in ["main", "master"] {
            if git::commit(root, &format!("refs/heads/{branch}"))?.is_some() {
                candidates.push(branch);
            }
        }
        if candidates.len() != 1 {
            return Err(Error::new(
                "Set git config wt.base BRANCH to identify the integration branch; an initial commit is required.",
            ));
        }
        candidates[0].into()
    };
    if !git::valid_branch(root, &base)? {
        return Err(Error::new(
            "wt.base must name a branch, not an arbitrary revision.",
        ));
    }
    Ok(base)
}

fn home() -> Result<PathBuf> {
    if let Some(home) = env::var_os("HOME") {
        return Ok(PathBuf::from(home));
    }
    // SAFETY: getpwuid returns a system-owned record; copy its directory immediately.
    unsafe {
        let record = libc::getpwuid(libc::getuid());
        if record.is_null() {
            return Err(Error::new("Could not determine home directory."));
        }
        use std::os::unix::ffi::OsStrExt;
        let directory = std::ffi::CStr::from_ptr((*record).pw_dir);
        Ok(PathBuf::from(std::ffi::OsStr::from_bytes(
            directory.to_bytes(),
        )))
    }
}

fn worktree_root(cwd: &Path, home: &Path) -> Result<PathBuf> {
    let setting = env::var_os("WT_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".worktrees"));
    let expanded = expand_home(&setting, home)?;
    let absolute = if expanded.is_absolute() {
        expanded
    } else {
        cwd.join(expanded)
    };
    let absolute: PathBuf = absolute.components().collect();
    if absolute.is_symlink() || resolve(&absolute)?.as_os_str() != absolute.as_os_str() {
        return Err(Error::new(
            "The worktree root must be a canonical directory, not a symlink.",
        ));
    }
    Ok(absolute)
}

fn expand_home(setting: &Path, home: &Path) -> Result<PathBuf> {
    use std::os::unix::ffi::OsStrExt;
    let mut components = setting.components();
    let Some(Component::Normal(first)) = components.next() else {
        return Ok(setting.into());
    };
    let Some(username) = first.as_bytes().strip_prefix(b"~") else {
        return Ok(setting.into());
    };
    let directory = if username.is_empty() {
        home.to_path_buf()
    } else {
        let username = std::ffi::CString::new(username)
            .map_err(|_| Error::new("Could not determine home directory."))?;
        // SAFETY: username is NUL-terminated; copy the system-owned directory
        // immediately, before any further account lookup.
        unsafe {
            let record = libc::getpwnam(username.as_ptr());
            if record.is_null() {
                return Err(Error::new("Could not determine home directory."));
            }
            let directory = std::ffi::CStr::from_ptr((*record).pw_dir);
            PathBuf::from(std::ffi::OsStr::from_bytes(directory.to_bytes()))
        }
    };
    Ok(directory.join(components.as_path()))
}

// Path.resolve(strict=False): resolve existing prefixes, including symlinks,
// while permitting a worktree root which has not been created yet.
fn resolve(path: &Path) -> Result<PathBuf> {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => (),
            Component::ParentDir => {
                resolved.pop();
            }
            other => {
                resolved.push(other.as_os_str());
                match fs::canonicalize(&resolved) {
                    Ok(canonical) => resolved = canonical,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
                    Err(error) => return Err(error.into()),
                }
            }
        }
    }
    Ok(resolved)
}

#[cfg(test)]
#[path = "../tests/support/ownership_bytes.rs"]
mod ownership_bytes;

#[cfg(test)]
mod tests {
    use super::task_name;

    #[test]
    fn accepts_task_boundary_lengths() {
        for name in ["a", &"a".repeat(64), "Task_123-xyz"] {
            assert!(task_name(name));
        }
    }

    #[test]
    fn rejects_unsafe_task_names() {
        for name in [
            "",
            &"a".repeat(65),
            "../escape",
            "-option",
            "雪",
            "🐍",
            "a\n",
            "x';",
        ] {
            assert!(!task_name(name));
        }
    }
}
