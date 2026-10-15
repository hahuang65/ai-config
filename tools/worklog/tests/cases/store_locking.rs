use super::*;
use crate::model::{Kind, SCHEMA};

// See test/timings.md for tuning constraints and verification.
const LOCK_DEADLINE: Duration = Duration::from_millis(10);
const COMPLETION_GUARD: Duration = Duration::from_secs(1);
const CONTENTION_GUARD: Duration = Duration::from_secs(1);

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

#[test]
fn a_waiting_writer_retries_contention_then_recovers_without_losing_history() {
    let home = tempfile::tempdir().unwrap();
    let store = Store {
        root: home.path().join("state"),
        lock_timeout: LOCK_TIMEOUT,
    };
    store.append(note).unwrap();
    let lock = private_options().open(store.root.join(".lock")).unwrap();
    FileExt::lock_exclusive(&lock).unwrap();
    let (blocked, observed) = std::sync::mpsc::channel();
    thread::scope(|scope| {
        let writer = scope.spawn(|| {
            store.append_observing_contention(note, ensure_directory, || {
                let _ = blocked.send(());
            })
        });
        let retried = (0..2).all(|_| observed.recv_timeout(CONTENTION_GUARD).is_ok());
        let before_release = store.read().unwrap().entries.len();
        // Always release before checking the watchdog result, so failure cannot
        // strand the writer behind a lock owned by the asserting thread.
        FileExt::unlock(&lock).unwrap();
        let result = writer.join().unwrap();
        assert!(retried, "the writer did not report two real lock conflicts");
        assert_eq!(before_release, 1);
        assert_eq!(result.unwrap().id, 2);
    });
    assert_eq!(store.read().unwrap().entries.len(), 2);
}

#[test]
fn a_short_lock_deadline_preserves_history_and_allows_recovery() {
    let home = tempfile::tempdir().unwrap();
    let store = Store {
        root: home.path().join("state"),
        lock_timeout: LOCK_DEADLINE,
    };
    store.append(note).unwrap();
    let lock = private_options().open(store.root.join(".lock")).unwrap();
    FileExt::lock_exclusive(&lock).unwrap();
    let started = Instant::now();
    let error = store.append(note).unwrap_err();
    assert_eq!(error.code, 1);
    assert_eq!(error.message, Error::busy().message);
    assert!(started.elapsed() >= LOCK_DEADLINE);
    assert!(started.elapsed() < COMPLETION_GUARD);
    assert_eq!(store.read().unwrap().entries.len(), 1);
    FileExt::unlock(&lock).unwrap();
    assert_eq!(store.append(note).unwrap().id, 2);
    assert_eq!(store.read().unwrap().entries.len(), 2);
}
