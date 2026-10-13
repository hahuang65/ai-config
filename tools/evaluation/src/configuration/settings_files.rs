//! Filesystem boundary for settings; rollback snapshots remain in memory only.
use super::document::{self, Document};
use super::settings::{self, Setting};
use super::{Targets, real_ancestors};
use anyhow::{Context, Result, ensure};
use std::collections::BTreeSet;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt, symlink};
use std::path::{Path, PathBuf};

#[derive(Clone, PartialEq, Eq)]
pub(super) struct Snapshot {
    bytes: Vec<u8>,
    mode: u32,
    link: Option<PathBuf>,
}

pub(super) struct Change {
    destination: PathBuf,
    before: Option<Snapshot>,
    after: Option<Snapshot>,
}

pub(super) fn plan_with_links(
    home: &Path,
    previous: &[Setting],
    desired: &[Setting],
    linked: &Targets,
) -> Result<Vec<Change>> {
    let destinations: BTreeSet<_> = previous
        .iter()
        .chain(desired.iter())
        .map(|setting| &setting.destination)
        .chain(linked.keys())
        .collect();
    let mut changes = Vec::new();
    for destination in destinations {
        let path = home.join(destination);
        let before = read_permitted(&path, linked.get(destination).map(PathBuf::as_path))?;
        let current = match &before {
            Some(snapshot) => document::object(&snapshot.bytes)?,
            None => Document::empty(),
        };
        let old: Vec<_> = previous
            .iter()
            .filter(|setting| &setting.destination == destination)
            .collect();
        let new: Vec<_> = desired
            .iter()
            .filter(|setting| &setting.destination == destination)
            .collect();
        let merged = settings::merge(&current, &old, &new)?;
        if current == merged
            && before
                .as_ref()
                .is_none_or(|snapshot| snapshot.link.is_none())
        {
            continue;
        }
        let after = Some(replacement(&merged, &current, before.as_ref())?);
        changes.push(Change {
            destination: path,
            before,
            after,
        });
    }
    Ok(changes)
}

fn replacement(
    merged: &Document,
    current: &Document,
    before: Option<&Snapshot>,
) -> Result<Snapshot> {
    let bytes = if merged == current {
        before
            .context("Missing unchanged settings snapshot")?
            .bytes
            .clone()
    } else {
        let mut bytes = serde_json::to_vec_pretty(merged)?;
        bytes.push(b'\n');
        bytes
    };
    let mode = before
        .filter(|snapshot| snapshot.link.is_none())
        .map_or(0o600, |snapshot| snapshot.mode);
    Ok(Snapshot {
        bytes,
        mode,
        link: None,
    })
}

fn read_permitted(path: &Path, permitted: Option<&Path>) -> Result<Option<Snapshot>> {
    real_ancestors(path.parent().context("Missing settings parent")?)?;
    if !crate::paths::present(path)? || !fs::symlink_metadata(path)?.is_symlink() {
        return read(path);
    }
    let target = permitted.context("Refusing settings link without explicit legacy ownership")?;
    ensure!(
        fs::read_link(path)?.as_os_str() == target.as_os_str(),
        "Legacy settings link does not match the declared raw target"
    );
    let mut snapshot = read(target)?.context("Legacy settings source is missing")?;
    snapshot.link = Some(target.to_owned());
    Ok(Some(snapshot))
}

fn read(path: &Path) -> Result<Option<Snapshot>> {
    real_ancestors(path.parent().context("Missing settings parent")?)?;
    if !crate::paths::present(path)? {
        return Ok(None);
    }
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(path)?;
    let metadata = file.metadata()?;
    ensure!(
        metadata.is_file() && metadata.nlink() == 1,
        "Settings must be a regular file without hard links"
    );
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    Ok(Some(Snapshot {
        bytes,
        mode: metadata.permissions().mode() & 0o777,
        link: None,
    }))
}

impl Change {
    pub fn apply(&self, reverse: bool) -> Result<()> {
        let (expected, replacement) = if reverse {
            (&self.after, &self.before)
        } else {
            (&self.before, &self.after)
        };
        ensure!(
            &read_permitted(
                &self.destination,
                expected
                    .as_ref()
                    .and_then(|snapshot| snapshot.link.as_deref())
            )? == expected,
            "Settings changed during installation; refusing to overwrite them"
        );
        let Some(snapshot) = replacement else {
            fs::remove_file(&self.destination)?;
            return Ok(());
        };
        write_snapshot(&self.destination, snapshot)
    }
}

fn write_snapshot(destination: &Path, snapshot: &Snapshot) -> Result<()> {
    let parent = destination.parent().context("Missing settings parent")?;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(parent)?;
    if let Some(target) = &snapshot.link {
        let staging = tempfile::Builder::new()
            .prefix(".ai-config-")
            .tempdir_in(parent)?;
        let link = staging.path().join("link");
        symlink(target, &link)?;
        fs::rename(link, destination)?;
        return Ok(());
    }
    let mut staged = tempfile::NamedTempFile::new_in(parent)?;
    staged.write_all(&snapshot.bytes)?;
    staged
        .as_file()
        .set_permissions(fs::Permissions::from_mode(snapshot.mode))?;
    staged.as_file().sync_all()?;
    staged.persist(destination)?;
    Ok(())
}
