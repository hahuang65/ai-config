use super::*;
use crate::model::{Kind, SCHEMA};
use std::io;

fn note(log: &Log) -> Result<Entry> {
    let id = log.next_id()?;
    Ok(Entry {
        schema: SCHEMA,
        id,
        at: "2026-01-01T00:00:00Z".to_owned(),
        project: None,
        task: Some(id),
        kind: Kind::Note,
        text: "Reminder".to_owned(),
        commit: None,
        corrects: None,
    })
}

fn create_racing_directory(path: &Path) -> io::Result<()> {
    create_private_directory(path)?;
    Err(io::ErrorKind::AlreadyExists.into())
}

fn interrupted_sync(_: &Path) -> io::Result<()> {
    Err(io::ErrorKind::Interrupted.into())
}

#[test]
fn interrupted_first_initializer_is_synced_by_the_following_writer() {
    let home = tempfile::tempdir().unwrap();
    let store = Store {
        root: home.path().join("state"),
    };
    let interrupted = store.append_with_initializer(note, |path| {
        ensure_directory_with(path, create_private_directory, interrupted_sync)
    });
    assert!(interrupted.is_err());
    assert!(store.root.is_dir());
    assert!(store.read().unwrap().entries.is_empty());

    let mut synced = Vec::new();
    let entry = store
        .append_with_initializer(note, |path| {
            ensure_directory_with(path, create_private_directory, |parent| {
                File::open(parent)?.sync_all()?;
                synced.push(parent.to_path_buf());
                Ok(())
            })
        })
        .unwrap();
    assert_eq!(synced, vec![home.path().to_path_buf()]);
    assert_eq!(entry.id, 1);
    assert_eq!(store.read().unwrap().entries.len(), 1);
}

#[test]
fn a_create_race_is_synced_before_the_writer_acknowledges_publication() {
    let home = tempfile::tempdir().unwrap();
    let store = Store {
        root: home.path().join("state"),
    };
    let mut synced = Vec::new();
    let entry = store
        .append_with_initializer(note, |path| {
            ensure_directory_with(path, create_racing_directory, |parent| {
                File::open(parent)?.sync_all()?;
                synced.push(parent.to_path_buf());
                Ok(())
            })
        })
        .unwrap();
    assert_eq!(synced, vec![home.path().to_path_buf()]);
    assert_eq!(entry.id, 1);
    assert_eq!(store.read().unwrap().entries.len(), 1);
}

#[test]
fn every_writer_rejects_a_parent_sync_failure_without_publishing() {
    for existing in [false, true] {
        let home = tempfile::tempdir().unwrap();
        let store = Store {
            root: home.path().join("state"),
        };
        if existing {
            create_private_directory(&store.root).unwrap();
        }
        let rejected = store.append_with_initializer(note, |path| {
            ensure_directory_with(path, create_racing_directory, interrupted_sync)
        });
        assert!(rejected.is_err(), "existing root: {existing}");
        assert!(!store.root.join("events").exists());
        assert!(store.read().unwrap().entries.is_empty());
        assert_eq!(store.append(note).unwrap().id, 1);
    }
}
