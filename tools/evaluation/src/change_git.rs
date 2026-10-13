use crate::{
    change_types::{
        Blob, Exclusions, MAX_BYTES, MAX_FILES, Tree, private_path, relative_path, text,
    },
    reviewer_process,
};
use anyhow::{Context, Result, ensure};
use std::{
    collections::BTreeSet,
    fs,
    io::Read,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::Command,
};

pub fn command(repo: &Path) -> Result<Command> {
    command_excluding(repo, repo)
}

pub fn command_excluding(repo: &Path, source: &Path) -> Result<Command> {
    let mut command = crate::change_command::command("git", &[repo, source])?;
    command
        .current_dir(std::env::temp_dir())
        .args([
            "--no-pager",
            "--no-optional-locks",
            "--no-lazy-fetch",
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "core.attributesFile=/dev/null",
            "-c",
            "core.quotePath=false",
            "-C",
        ])
        .arg(repo);
    for (key, _) in std::env::vars_os() {
        if key.to_str().is_some_and(|key| key.starts_with("GIT_")) {
            command.env_remove(key);
        }
    }
    command
        .env("GIT_NO_REPLACE_OBJECTS", "1")
        .env("GIT_LITERAL_PATHSPECS", "1")
        .env("GIT_NO_LAZY_FETCH", "1");
    Ok(command)
}

pub fn run(repo: &Path, args: &[&str]) -> Result<Vec<u8>> {
    let mut command = command(repo)?;
    command.args(args);
    reviewer_process::run(command, 30).context("Cannot read Git evidence")
}

pub fn root(repo: &Path) -> Result<PathBuf> {
    let repo = repo
        .canonicalize()
        .context("Cannot resolve repository directory")?;
    let output = run(&repo, &["rev-parse", "--show-toplevel"])?;
    let path = std::str::from_utf8(&output)?.trim_end_matches('\n');
    text(path, 4096)?;
    ensure!(
        !path.contains(['\n', '\t']),
        "Repository path contains controls"
    );
    Ok(PathBuf::from(path).canonicalize()?)
}

pub fn revision(repo: &Path, name: &str) -> Result<String> {
    let output = run(
        repo,
        &[
            "rev-parse",
            "--verify",
            "--end-of-options",
            &format!("{name}^{{commit}}"),
        ],
    )?;
    let oid = std::str::from_utf8(&output)?.trim().to_owned();
    ensure!(valid_oid(&oid), "Git returned an invalid object identifier");
    Ok(oid)
}

pub fn valid_oid(value: &str) -> bool {
    matches!(value.len(), 40 | 64)
        && value
            .bytes()
            .all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase())
}

fn include(path: &str, excluded: &mut Exclusions) -> Result<bool> {
    relative_path(path)?;
    if private_path(path) {
        excluded.insert(path.into(), format!("Private path excluded: {path}"));
        return Ok(false);
    }
    Ok(true)
}

fn insert(tree: &mut Tree, path: String, blob: Blob, excluded: &mut Exclusions) -> Result<()> {
    if blob.bytes.contains(&0) || std::str::from_utf8(&blob.bytes).is_err() {
        excluded.insert(path.clone(), format!("Non-text file excluded: {path}"));
        return Ok(());
    }
    tree.insert(path, blob);
    ensure!(
        tree.len() <= MAX_FILES
            && tree.values().map(|blob| blob.bytes.len()).sum::<usize>() <= MAX_BYTES,
        "Snapshot exceeds 2000 files or 12 MiB; choose a smaller explicit scope"
    );
    Ok(())
}

pub fn tree(
    repo: &Path,
    revision: &str,
    excluded: &mut Exclusions,
    filter: Option<&str>,
) -> Result<Tree> {
    let mut args = vec!["ls-tree", "-rz", "--full-tree", revision, "--"];
    args.extend(filter);
    let listing = run(repo, &args)?;
    let mut tree = Tree::new();
    let entries: Vec<_> = listing
        .split(|b| *b == 0)
        .filter(|b| !b.is_empty())
        .collect();
    ensure!(
        entries.len() <= MAX_FILES,
        "Git tree exceeds the 2000-file limit"
    );
    for entry in entries {
        let (metadata, path) = std::str::from_utf8(entry)?
            .split_once('\t')
            .context("Malformed Git tree")?;
        if !include(path, excluded)? {
            continue;
        }
        let parts: Vec<_> = metadata.split(' ').collect();
        ensure!(
            parts.len() == 3 && valid_oid(parts[2]),
            "Malformed Git tree entry"
        );
        if !matches!(parts[0], "100644" | "100755") {
            excluded.insert(
                path.into(),
                format!("Symlink or submodule excluded: {path}"),
            );
            continue;
        }
        insert(
            &mut tree,
            path.into(),
            Blob {
                bytes: run(repo, &["cat-file", "blob", parts[2]])?,
                executable: parts[0] == "100755",
            },
            excluded,
        )?;
    }
    Ok(tree)
}

pub fn working(repo: &Path, excluded: &mut Exclusions, filter: Option<&str>) -> Result<Tree> {
    let mut args = vec![
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
    ];
    args.extend(filter);
    let listing = run(repo, &args)?;
    let paths: BTreeSet<_> = listing
        .split(|b| *b == 0)
        .filter(|b| !b.is_empty())
        .collect();
    ensure!(
        paths.len() <= MAX_FILES,
        "Working tree exceeds the 2000-file limit"
    );
    let mut tree = Tree::new();
    for path in paths {
        let path = std::str::from_utf8(path)?;
        if !include(path, excluded)? {
            continue;
        }
        if let Some(bytes) = read_working(repo, path, excluded)? {
            insert(&mut tree, path.into(), bytes, excluded)?;
        }
    }
    Ok(tree)
}

fn read_working(repo: &Path, path: &str, excluded: &mut Exclusions) -> Result<Option<Blob>> {
    let mut location = repo.to_owned();
    for component in Path::new(path).components() {
        location.push(component);
        let metadata = match fs::symlink_metadata(&location) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        if metadata.is_symlink() {
            excluded.insert(path.into(), format!("Symlink excluded: {path}"));
            return Ok(None);
        }
    }
    if !location.is_file() {
        excluded.insert(path.into(), format!("Non-regular file excluded: {path}"));
        return Ok(None);
    }
    let file = fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(location)?;
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file(),
        "Source file changed type during capture"
    );
    let executable = metadata.permissions().mode() & 0o100 != 0;
    let mut bytes = vec![];
    file.take((MAX_BYTES + 1) as u64).read_to_end(&mut bytes)?;
    ensure!(
        bytes.len() <= MAX_BYTES,
        "Working file exceeds the 12 MiB limit"
    );
    Ok(Some(Blob { bytes, executable }))
}
