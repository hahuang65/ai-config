use anyhow::{Context, Result, ensure};
use std::{
    collections::BTreeSet,
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::Command,
};

const SOURCE_CONTEXT: &str = "AI_REVIEW_EXCLUDED_SOURCES";

thread_local! {
    static REVIEW_SOURCES: std::cell::RefCell<Vec<PathBuf>> = const { std::cell::RefCell::new(Vec::new()) };
}

struct SourceScope(Vec<PathBuf>);
impl Drop for SourceScope {
    fn drop(&mut self) {
        REVIEW_SOURCES.with(|sources| *sources.borrow_mut() = std::mem::take(&mut self.0));
    }
}

/// Keep an explicit --repo source excluded even when acquisition changes the Git directory.
/// This is thread-local request context, never a process-wide environment mutation.
pub(crate) fn with_source<T>(source: &Path, operation: impl FnOnce() -> Result<T>) -> Result<T> {
    with_sources(&[source.to_owned()], operation)
}

/// Restore additional-only exclusions from a retained report without changing process environment.
pub fn with_sources<T>(sources: &[PathBuf], operation: impl FnOnce() -> Result<T>) -> Result<T> {
    let paths: Vec<_> = sources.iter().map(PathBuf::as_path).collect();
    let roots = source_roots(&paths)?;
    let previous = REVIEW_SOURCES.with(|sources| sources.replace(roots));
    let _scope = SourceScope(previous);
    operation()
}

pub(crate) fn source_roots(excluded: &[&Path]) -> Result<Vec<PathBuf>> {
    let cwd = std::env::current_dir()?.canonicalize()?;
    let mut roots = BTreeSet::new();
    roots.extend(REVIEW_SOURCES.with(|sources| sources.borrow().clone()));
    if let Some(root) = cwd
        .ancestors()
        .find(|path| fs::symlink_metadata(path.join(".git")).is_ok())
    {
        roots.insert(root.to_owned());
    }
    let inherited = std::env::var(SOURCE_CONTEXT).unwrap_or_else(|_| "[]".into());
    ensure!(
        inherited.len() <= 32768,
        "Inherited source exclusion context exceeds its limit"
    );
    let inherited: Vec<PathBuf> =
        serde_json::from_str(&inherited).context("Invalid source exclusion context")?;
    ensure!(
        inherited.len() <= 128 && inherited.iter().all(|path| path.is_absolute()),
        "Invalid source exclusion roots"
    );
    for path in inherited
        .iter()
        .map(PathBuf::as_path)
        .chain(excluded.iter().copied())
    {
        let absolute = if path.is_absolute() {
            path.to_owned()
        } else {
            cwd.join(path)
        };
        let absolute = absolute.canonicalize().unwrap_or(absolute);
        let root = absolute
            .ancestors()
            .find(|path| fs::symlink_metadata(path.join(".git")).is_ok())
            .unwrap_or(&absolute);
        roots.insert(root.to_owned());
    }
    ensure!(roots.len() <= 128, "Too many excluded source roots");
    Ok(roots.into_iter().collect())
}

fn directories(excluded: &[PathBuf]) -> Vec<PathBuf> {
    std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .filter(|directory| directory.is_absolute())
        .filter_map(|directory| directory.canonicalize().ok())
        .filter(|directory| {
            directory.is_dir() && !excluded.iter().any(|root| directory.starts_with(root))
        })
        .collect()
}

fn configure(command: &mut Command, excluded: &[PathBuf], directories: &[PathBuf]) -> Result<()> {
    command
        .env("PATH", std::env::join_paths(directories)?)
        .env(SOURCE_CONTEXT, serde_json::to_string(excluded)?);
    clean_startup(command);
    command.current_dir(std::env::temp_dir());
    Ok(())
}

pub fn command(name: &str, excluded: &[&Path]) -> Result<Command> {
    let excluded = source_roots(excluded)?;
    let directories = directories(&excluded);
    let executable = directories
        .iter()
        .filter_map(|directory| directory.join(name).canonicalize().ok())
        .find(|path| {
            !excluded.iter().any(|root| path.starts_with(root))
                // Unix mise shims resolve to mise itself, not an installed Pi.
                && !(name == "pi" && path.file_name().is_some_and(|file| file == "mise"))
                && fs::metadata(path)
                    .is_ok_and(|meta| meta.is_file() && meta.permissions().mode() & 0o111 != 0)
        })
        .with_context(|| {
            format!("Cannot find {name} outside reviewed source on an absolute PATH entry")
        })?;
    let mut command = Command::new(executable);
    configure(&mut command, &excluded, &directories)?;
    Ok(command)
}

/// Launch an explicitly selected trusted package helper with the same source exclusions.
pub fn trusted(executable: &Path, excluded: &[&Path]) -> Result<Command> {
    let excluded = source_roots(excluded)?;
    let directories = directories(&excluded);
    let mut command = Command::new(
        executable
            .canonicalize()
            .context("Cannot locate trusted package helper")?,
    );
    configure(&mut command, &excluded, &directories)?;
    Ok(command)
}

pub(crate) fn clean_startup(command: &mut Command) {
    for key in [
        "NODE_OPTIONS",
        "NODE_PATH",
        "PI_CODING_AGENT_SESSION_DIR",
        "BASH_ENV",
        "ENV",
        "ZDOTDIR",
        "CDPATH",
    ] {
        command.env_remove(key);
    }
    for (key, _) in std::env::vars_os() {
        if key
            .to_str()
            .is_some_and(|key| key.starts_with("GIT_") || key.starts_with("BASH_FUNC_"))
        {
            command.env_remove(key);
        }
    }
}
