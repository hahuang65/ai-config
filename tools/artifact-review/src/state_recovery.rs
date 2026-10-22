use crate::paths::{Paths, Result, hash, read_artifact};
use fs2::FileExt;
use rusqlite::{Connection, OpenFlags};
use serde_json::{Value, json};
use std::{
    fs::{self, OpenOptions},
    os::unix::fs::{MetadataExt, OpenOptionsExt, PermissionsExt},
    path::Path,
};

pub fn recover(file: &Path, from_root: &Path) -> Result<Value> {
    if !from_root.is_absolute() {
        return Err("--from-root must be an absolute private directory.");
    }
    private_directory(from_root)?;
    read_artifact(file)?;
    let artifact = file
        .canonicalize()
        .map_err(|_| "Cannot resolve recovery artifact.")?;
    let source = from_root.join(hash(artifact.as_os_str().as_encoded_bytes()));
    private_directory(&source)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(source.join("server.lock"))
        .map_err(|_| "Cannot open the original review lock.")?;
    FileExt::try_lock_exclusive(&lock).map_err(|_| "Original review is still running or locked. Stop it with AR_ROOT set to --from-root first.")?;
    validate_source(&source)?;
    let paths = Paths::resolve(&artifact)?;
    if paths.directory == source
        || paths.directory.canonicalize().ok() == source.canonicalize().ok()
    {
        return Err("Source and destination review state are the same; no recovery is needed.");
    }
    if fs::read_dir(&paths.directory)
        .map_err(|_| "Cannot inspect destination review state.")?
        .next()
        .is_some()
    {
        return Err(
            "Destination review state already exists. Recovery will not merge or overwrite it.",
        );
    }
    // Renaming the whole stopped store keeps SQLite journals and the original decisions together.
    // A concurrently populated destination makes rename fail instead of overwriting that store.
    fs::rename(&source, &paths.directory).map_err(|_| "Cannot move review state atomically. Keep both roots on the same filesystem and retry.")?;
    Ok(
        json!({"status":"recovered","artifact":paths.artifact,"from_root":from_root,
        "state_root":paths.directory.parent(),"next":"Open the same artifact to reattach its original conversation."}),
    )
}

fn private_directory(path: &Path) -> Result<()> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|_| "Recovery source must be an existing private directory.")?;
    if !metadata.is_dir()
        || metadata.permissions().mode() & 0o077 != 0
        || metadata.uid() != unsafe { libc::geteuid() }
    {
        return Err("Recovery source must be a private real directory owned by this user.");
    }
    Ok(())
}

fn validate_source(source: &Path) -> Result<()> {
    let allowed = [
        "events.sqlite",
        "events.sqlite-wal",
        "events.sqlite-shm",
        "events.sqlite-journal",
        "server.lock",
    ];
    for entry in fs::read_dir(source).map_err(|_| "Cannot inspect original review state.")? {
        let entry = entry.map_err(|_| "Cannot inspect original review state entry.")?;
        let metadata = fs::symlink_metadata(entry.path())
            .map_err(|_| "Cannot inspect original review state file.")?;
        if !allowed.iter().any(|name| entry.file_name() == *name)
            || !metadata.is_file()
            || metadata.permissions().mode() & 0o077 != 0
            || metadata.uid() != unsafe { libc::geteuid() }
        {
            return Err(
                "Original review state contains an unexpected, linked, public, or live-server file. Stop and inspect it before recovery.",
            );
        }
    }
    let connection = Connection::open_with_flags(
        source.join("events.sqlite"),
        OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .map_err(|_| "Cannot read the original review event store.")?;
    connection
        .busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| "Cannot bound review recovery reads.")?;
    let active: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM feedback_jobs WHERE state='working' AND lease_until>unixepoch())", [], |row| row.get(0),
    ).map_err(|_| "Cannot verify original feedback claims.")?;
    if active {
        return Err(
            "Original review still has an active feedback claim. Finish or abandon it before recovery.",
        );
    }
    Ok(())
}
