use crate::{
    feedback::Origin,
    paths::{Paths, Result, private_file, state_root},
};
use rusqlite::{Connection, OptionalExtension, params};
use std::{
    os::unix::fs::{MetadataExt, PermissionsExt},
    path::{Path, PathBuf},
    time::Duration,
};

fn connection() -> Result<Connection> {
    let path = state_root()?.join("routing.sqlite");
    let file = private_file(&path)?;
    let metadata = file
        .metadata()
        .map_err(|_| "Cannot inspect feedback routing state.")?;
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.permissions().mode() & 0o077 != 0
    {
        return Err("Feedback routing state must be a private regular file owned by this user.");
    }
    let connection = Connection::open(path).map_err(|_| "Cannot open feedback routing state.")?;
    connection
        .busy_timeout(Duration::from_secs(3))
        .map_err(|_| "Cannot configure feedback routing state.")?;
    connection
        .execute_batch(
            "PRAGMA synchronous=FULL;
        CREATE TABLE IF NOT EXISTS attachments (
          origin TEXT NOT NULL, artifact TEXT NOT NULL, notified_cursor INTEGER NOT NULL DEFAULT 0, active_lease TEXT, PRIMARY KEY(origin,artifact)
        );
        CREATE TABLE IF NOT EXISTS current_workspaces (
          harness TEXT NOT NULL, conversation TEXT NOT NULL, workspace TEXT NOT NULL, PRIMARY KEY(harness,conversation)
        );",
        )
        .map_err(|_| "Cannot initialize feedback routing state.")?;
    Ok(connection)
}

pub fn focus(origin: &Origin) -> Result<()> {
    let mut connection = connection()?;
    let transaction = connection
        .transaction()
        .map_err(|_| "Cannot update current feedback workspace.")?;
    if workspace(&transaction, origin)?.as_deref() != origin.workspace.to_str() {
        let encoded =
            serde_json::to_string(origin).map_err(|_| "Cannot encode feedback origin.")?;
        transaction
            .execute(
                "UPDATE attachments SET notified_cursor=0 WHERE origin=?1",
                [encoded],
            )
            .map_err(|_| "Cannot queue feedback for workspace re-entry.")?;
        transaction
            .execute(
                "INSERT INTO current_workspaces(harness,conversation,workspace) VALUES(?1,?2,?3)
             ON CONFLICT(harness,conversation) DO UPDATE SET workspace=excluded.workspace",
                params![
                    origin.harness,
                    origin.conversation,
                    origin
                        .workspace
                        .to_str()
                        .ok_or("Workspace must be UTF-8.")?
                ],
            )
            .map_err(|_| "Cannot save current feedback workspace.")?;
    }
    transaction
        .commit()
        .map_err(|_| "Cannot commit current feedback workspace.")
}

fn workspace(connection: &Connection, origin: &Origin) -> Result<Option<String>> {
    connection
        .query_row(
            "SELECT workspace FROM current_workspaces WHERE harness=?1 AND conversation=?2",
            params![origin.harness, origin.conversation],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "Cannot read current feedback workspace.")
}

pub fn is_current(origin: &Origin) -> Result<bool> {
    Ok(workspace(&connection()?, origin)?
        .is_none_or(|current| Some(current.as_str()) == origin.workspace.to_str()))
}

pub fn validate_claim(origin: &Origin) -> Result<()> {
    if let Some(current) = workspace(&connection()?, origin)?
        && (Some(current.as_str()) != origin.workspace.to_str()
            || std::env::current_dir()
                .ok()
                .and_then(|path| path.canonicalize().ok())
                .as_ref()
                != Some(&origin.workspace))
    {
        return Err(
            "Feedback workspace is inactive. Return to its originating workspace before claiming it.",
        );
    }
    Ok(())
}

pub fn register(paths: &Paths, origin: &Origin) -> Result<()> {
    let encoded = serde_json::to_string(origin).map_err(|_| "Cannot encode feedback origin.")?;
    let artifact = paths
        .artifact
        .to_str()
        .ok_or("Feedback artifact paths must be UTF-8.")?;
    let mut connection = connection()?;
    let transaction = connection
        .transaction()
        .map_err(|_| "Cannot register feedback routing.")?;
    let count: i64 = transaction
        .query_row(
            "SELECT COUNT(*) FROM attachments WHERE origin=?1 AND artifact<>?2",
            params![encoded, artifact],
            |row| row.get(0),
        )
        .map_err(|_| "Cannot count attached artifacts.")?;
    if count >= 50 {
        return Err("A conversation can attach at most 50 review artifacts.");
    }
    transaction
        .execute(
            "INSERT OR IGNORE INTO attachments(origin,artifact) VALUES(?1,?2)",
            params![encoded, artifact],
        )
        .map_err(|_| "Cannot save feedback routing.")?;
    transaction
        .commit()
        .map_err(|_| "Cannot commit feedback routing.")
}

#[derive(serde::Deserialize, serde::Serialize)]
pub struct Active {
    pub artifact: PathBuf,
    pub lease: crate::feedback::Lease,
}

pub fn activate(paths: &Paths, origin: &Origin, lease: &crate::feedback::Lease) -> Result<()> {
    let origin = serde_json::to_string(origin).map_err(|_| "Cannot encode feedback origin.")?;
    let lease = serde_json::to_string(lease).map_err(|_| "Cannot encode feedback lease.")?;
    let artifact = paths
        .artifact
        .to_str()
        .ok_or("Feedback artifact paths must be UTF-8.")?;
    let changed = connection()?
        .execute(
            "UPDATE attachments SET active_lease=?3 WHERE origin=?1 AND artifact=?2",
            params![origin, artifact, lease],
        )
        .map_err(|_| "Cannot record active feedback.")?;
    if changed != 1 {
        return Err("Feedback routing changed. Reopen the artifact.");
    }
    Ok(())
}

pub fn clear_active(artifact: &Path, lease: &crate::feedback::Lease) -> Result<()> {
    let lease = serde_json::to_string(lease).map_err(|_| "Cannot encode feedback lease.")?;
    let artifact = artifact
        .to_str()
        .ok_or("Feedback artifact paths must be UTF-8.")?;
    connection()?
        .execute(
            "UPDATE attachments SET active_lease=NULL WHERE artifact=?1 AND active_lease=?2",
            params![artifact, lease],
        )
        .map_err(|_| "Cannot clear completed feedback.")?;
    Ok(())
}

pub fn active(origin: &Origin, take: bool) -> Result<Vec<Active>> {
    let encoded = serde_json::to_string(origin).map_err(|_| "Cannot encode feedback origin.")?;
    let mut connection = connection()?;
    let transaction = connection
        .transaction()
        .map_err(|_| "Cannot read active feedback.")?;
    let result = read_active(&transaction, &encoded)?;
    if take {
        transaction
            .execute(
                "UPDATE attachments SET active_lease=NULL WHERE origin=?1",
                [&encoded],
            )
            .map_err(|_| "Cannot abandon active feedback.")?;
    }
    transaction
        .commit()
        .map_err(|_| "Cannot commit active feedback state.")?;
    Ok(result)
}

fn read_active(connection: &Connection, origin: &str) -> Result<Vec<Active>> {
    let mut statement = connection.prepare("SELECT artifact,active_lease FROM attachments WHERE origin=?1 AND active_lease IS NOT NULL ORDER BY artifact LIMIT 51")
        .map_err(|_| "Cannot read active feedback.")?;
    let rows = statement
        .query_map([origin], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "Cannot read active feedback.")?;
    let mut active = vec![];
    for row in rows {
        let (artifact, lease) = row.map_err(|_| "Invalid active feedback.")?;
        let lease: crate::feedback::Lease =
            serde_json::from_str(&lease).map_err(|_| "Invalid active feedback lease.")?;
        lease.validate()?;
        active.push(Active {
            artifact: artifact.into(),
            lease,
        });
    }
    if active.len() > 50 {
        return Err("Too many active feedback events.");
    }
    Ok(active)
}

pub fn mark_notified(paths: &Paths, origin: &Origin, cursor: i64) -> Result<bool> {
    let encoded = serde_json::to_string(origin).map_err(|_| "Cannot encode feedback origin.")?;
    let artifact = paths
        .artifact
        .to_str()
        .ok_or("Feedback artifact paths must be UTF-8.")?;
    let changed = connection()?.execute(
        "UPDATE attachments SET notified_cursor=?3 WHERE origin=?1 AND artifact=?2 AND notified_cursor<?3
         AND NOT EXISTS(SELECT 1 FROM current_workspaces WHERE harness=?4 AND conversation=?5 AND workspace<>?6)",
        params![encoded, artifact, cursor, origin.harness, origin.conversation, origin.workspace.to_str()],
    ).map_err(|_| "Cannot save feedback delivery cursor.")?;
    Ok(changed == 1)
}

pub fn reset_notifications(origin: &Origin) -> Result<()> {
    let encoded = serde_json::to_string(origin).map_err(|_| "Cannot encode feedback origin.")?;
    connection()?
        .execute(
            "UPDATE attachments SET notified_cursor=0 WHERE origin=?1",
            [encoded],
        )
        .map_err(|_| "Cannot recover queued feedback notifications.")?;
    Ok(())
}

pub fn attached(origin: Origin) -> Result<Vec<PathBuf>> {
    let origin = origin.validated()?;
    let encoded = serde_json::to_string(&origin).map_err(|_| "Cannot encode feedback origin.")?;
    let connection = connection()?;
    let mut statement = connection
        .prepare("SELECT artifact FROM attachments WHERE origin=?1 ORDER BY artifact LIMIT 51")
        .map_err(|_| "Cannot read attached artifacts.")?;
    let rows = statement
        .query_map([encoded], |row| row.get::<_, String>(0))
        .map_err(|_| "Cannot read attached artifacts.")?;
    let paths = rows
        .map(|row| row.map(PathBuf::from))
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| "Invalid attached artifact path.")?;
    if paths.len() > 50 {
        return Err("Too many attached artifacts in feedback routing state.");
    }
    Ok(paths)
}
