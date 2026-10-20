use crate::{
    client::Session,
    feedback::{Inbox, Origin},
    feedback_registry,
    paths::{Paths, Result, hash, private_file, state_root},
};
use fs2::FileExt;
use serde_json::{Value, json};
use std::{
    path::Path,
    time::{Duration, Instant},
};

pub fn listen(origin: Origin, seconds: u64) -> Result<Value> {
    let origin = origin.validated()?;
    let encoded = serde_json::to_vec(&origin).map_err(|_| "Cannot encode feedback origin.")?;
    let lock = private_file(&state_root()?.join(format!("listener-{}.lock", hash(&encoded))))?;
    if lock.try_lock_exclusive().is_err() {
        return Ok(json!({"state":"already_listening"}));
    }
    let deadline = Instant::now() + Duration::from_secs(seconds);
    let mut heartbeat = Instant::now();
    let mut skipped = false;
    loop {
        if !feedback_registry::is_current(&origin)? {
            return Ok(delivery(json!({"state":"idle"}), skipped));
        }
        let renew = Instant::now() >= heartbeat;
        let (notification, active) = if maintain(&origin, renew, &mut skipped)? {
            (None, true)
        } else {
            check(&origin, &mut skipped)?
        };
        if renew {
            heartbeat = Instant::now() + Duration::from_secs(20);
        }
        if let Some(notification) = notification {
            return Ok(delivery(notification, skipped));
        }
        if !active {
            return Ok(delivery(json!({"state":"idle"}), skipped));
        }
        if Instant::now() >= deadline {
            return Ok(delivery(json!({"state":"renew"}), skipped));
        }
        std::thread::sleep(
            Duration::from_millis(500).min(deadline.saturating_duration_since(Instant::now())),
        );
    }
}

fn maintain(origin: &Origin, renew: bool, skipped: &mut bool) -> Result<bool> {
    let mut active = false;
    for entry in feedback_registry::active(origin, false)? {
        if !renew || renew_entry(&entry).is_ok() {
            active = true;
        } else {
            feedback_registry::clear_active(&entry.artifact, &entry.lease)?;
            *skipped = true;
        }
    }
    Ok(active)
}

fn renew_entry(entry: &feedback_registry::Active) -> Result<()> {
    let paths = Paths::resolve(&entry.artifact)?;
    let body = serde_json::to_value(&entry.lease).map_err(|_| "Cannot encode feedback lease.")?;
    Session::connect(&paths)?.request("/feedback/renew", Some(&body))?;
    Ok(())
}

fn delivery(mut value: Value, skipped: bool) -> Value {
    if skipped {
        value["skipped_unavailable"] = json!(true);
    }
    value
}

fn inbox(artifact: &Path, body: &Value) -> Result<(Paths, Inbox)> {
    let paths = Paths::resolve(artifact)?;
    let result = Session::connect(&paths)?.request("/feedback/inbox", Some(body))?;
    let inbox = serde_json::from_value(result).map_err(|_| "Invalid feedback inbox.")?;
    Ok((paths, inbox))
}

fn check(origin: &Origin, skipped: &mut bool) -> Result<(Option<Value>, bool)> {
    let body = serde_json::to_value(origin).map_err(|_| "Cannot encode feedback origin.")?;
    let mut active = false;
    for artifact in feedback_registry::attached(origin.clone())? {
        let Ok((paths, inbox)) = inbox(&artifact, &body) else {
            *skipped = true;
            continue;
        };
        active |= inbox.open || inbox.processing.pending > 0;
        if let Some(pending) = inbox.pending
            && feedback_registry::mark_notified(&paths, origin, pending.cursor)?
        {
            return Ok((
                Some(json!({"state":"feedback","artifact":artifact,"pending":pending})),
                true,
            ));
        }
    }
    Ok((None, active))
}
