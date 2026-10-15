use crate::{paths::Result, store::Store};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::sync::watch;

pub const MAX_WAIT_MS: u64 = 30_000;

pub fn query(query: Option<&str>) -> Result<(u64, Duration)> {
    let query = query.unwrap_or("cursor=0");
    let (cursor, wait) = query.split_once("&wait_ms=").unwrap_or((query, "0"));
    let cursor = cursor
        .strip_prefix("cursor=")
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or("Use one unsigned cursor and optional wait_ms (0–30000).")?;
    let wait = wait
        .parse::<u64>()
        .ok()
        .filter(|value| *value <= MAX_WAIT_MS)
        .ok_or("Use one unsigned cursor and optional wait_ms (0–30000).")?;
    Ok((cursor, Duration::from_millis(wait)))
}

pub async fn wait(
    store: Arc<Mutex<Store>>,
    mut updates: watch::Receiver<bool>,
    cursor: u64,
    duration: Duration,
) -> Result<()> {
    if duration.is_zero() {
        return Ok(());
    }
    // Subscribe before checking the durable cursor so a concurrent save cannot be lost.
    let pending = async {
        loop {
            if *updates.borrow() {
                return Err("Review server is stopping. Reconnect with your saved cursor.");
            }
            let store = store.clone();
            let ready = tokio::task::spawn_blocking(move || {
                store.lock().expect("store lock").has_update(cursor)
            })
            .await
            .map_err(|_| "Cannot inspect review history.")??;
            if ready {
                return Ok(());
            }
            updates
                .changed()
                .await
                .map_err(|_| "Review server stopped. Reconnect with your saved cursor.")?;
        }
    };
    match tokio::time::timeout(duration, pending).await {
        Ok(result) => result,
        Err(_) => Ok(()),
    }
}
