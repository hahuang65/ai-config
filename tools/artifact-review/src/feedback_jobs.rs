use crate::{
    feedback::{Finish, Inbox, Job, Lease, Origin, Pending},
    feedback_store::expire,
    model::{Event, Submission, revision},
    paths::{Paths, Result},
    store::{Store, append_event},
};
use rusqlite::{Connection, OptionalExtension, Transaction, params};

impl Store {
    pub fn feedback_inbox(&self, paths: &Paths, origin: Origin) -> Result<Inbox> {
        let pending = self.pending_feedback(paths, origin)?;
        let open = self.status()? == "open"
            && !self
                .finding_review(None)?
                .is_some_and(|review| review.complete());
        Ok(Inbox {
            open,
            pending,
            processing: self.feedback_processing()?,
        })
    }

    pub fn pending_feedback(&self, paths: &Paths, origin: Origin) -> Result<Option<Pending>> {
        if self.feedback_origin()? != Some(origin.validated()?) {
            return Err("Feedback belongs to another conversation or workspace.");
        }
        expire(&self.0)?;
        let selected: Option<(i64, String, String)> = self.0.query_row(
            "SELECT jobs.cursor,events.payload,jobs.state FROM feedback_jobs jobs JOIN events USING(cursor)
             WHERE jobs.state IN ('queued','needs_attention') AND NOT EXISTS(SELECT 1 FROM feedback_jobs WHERE state='working')
             ORDER BY jobs.cursor LIMIT 1", [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional().map_err(|_| "Cannot read pending feedback.")?;
        let Some((cursor, encoded, state)) = selected else {
            return Ok(None);
        };
        let submission: Submission =
            serde_json::from_str(&encoded).map_err(|_| "Invalid pending feedback.")?;
        let current_revision = revision(paths)?;
        let stale = submission.revision != current_revision;
        Ok(Some(Pending {
            cursor,
            event: Event {
                cursor: cursor as u64,
                submission,
            },
            current_revision,
            stale,
            interrupted: state == "needs_attention",
        }))
    }

    pub fn claim_feedback(&mut self, paths: &Paths, origin: Origin) -> Result<Option<Job>> {
        let origin = origin.validated()?;
        if self.feedback_origin()?.as_ref() != Some(&origin) {
            return Err("Feedback belongs to another conversation or workspace.");
        }
        if !crate::feedback_registry::is_current(&origin)? {
            return Err("Feedback workspace is inactive. Return to its originating workspace.");
        }
        let current = revision(paths)?;
        let transaction = self.0.transaction().map_err(|_| "Cannot claim feedback.")?;
        expire(&transaction)?;
        let job = take_job(&transaction, current, true)?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit feedback claim.")?;
        Ok(job)
    }

    pub fn fail_feedback(&self, lease: &Lease) -> Result<()> {
        lease.validate()?;
        let changed = self.0.execute(
            "UPDATE feedback_jobs SET state='needs_attention',lease_until=NULL WHERE cursor=?1 AND attempt=?2
             AND state IN ('working','needs_attention')", params![lease.cursor, lease.attempt],
        ).map_err(|_| "Cannot retain interrupted feedback.")?;
        if changed != 1 {
            return Err("Feedback lease is invalid or already completed.");
        }
        Ok(())
    }

    pub fn renew_feedback(&self, lease: &Lease) -> Result<()> {
        lease.validate()?;
        expire(&self.0)?;
        let changed = self.0.execute(
            "UPDATE feedback_jobs SET lease_until=unixepoch()+60 WHERE cursor=?1 AND attempt=?2 AND state='working'",
            params![lease.cursor, lease.attempt],
        ).map_err(|_| "Cannot renew feedback lease.")?;
        if changed != 1 {
            return Err("Feedback lease is invalid or expired.");
        }
        Ok(())
    }

    pub fn finish_feedback(&mut self, paths: &Paths, finish: Finish) -> Result<u64> {
        finish.lease().validate()?;
        let reply = finish.reply();
        reply.validate()?;
        let encoded =
            serde_json::to_string(&finish).map_err(|_| "Cannot encode feedback completion.")?;
        let binding = self.finding_binding()?;
        let transaction = self
            .0
            .transaction()
            .map_err(|_| "Cannot finish feedback.")?;
        expire(&transaction)?;
        let previous = completion(&transaction, &finish)?;
        if previous.completed(&finish, &encoded)? {
            return Ok(previous
                .reply_cursor
                .ok_or("Missing feedback reply cursor.")? as u64);
        }
        let current = revision(paths)?;
        let updated = previous.starting_revision.as_deref() != Some(&current);
        if updated && binding.is_some_and(|binding| binding.revision != current) {
            return Err("Retained reports cannot be revised in place.");
        }
        let cursor = append_event(&transaction, &reply)?;
        transaction.execute(
            "UPDATE feedback_jobs SET state=?1,completion=?2,reply_cursor=?3,lease_until=NULL WHERE cursor=?4",
            params![if updated { "updated" } else { "answered" }, encoded, cursor as i64, finish.cursor],
        ).map_err(|_| "Cannot save feedback completion.")?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit feedback completion.")?;
        Ok(cursor)
    }
}

pub(crate) fn take_job(
    transaction: &Transaction<'_>,
    current_revision: String,
    interrupted: bool,
) -> Result<Option<Job>> {
    let selected: Option<(i64, String)> = transaction.query_row(
        "SELECT jobs.cursor,events.payload FROM feedback_jobs jobs JOIN events USING(cursor)
         WHERE (jobs.state='queued' OR (?1 AND jobs.state='needs_attention')) AND NOT EXISTS(SELECT 1 FROM feedback_jobs WHERE state='working')
         ORDER BY jobs.cursor LIMIT 1", [interrupted], |row| Ok((row.get(0)?, row.get(1)?)),
    ).optional().map_err(|_| "Cannot read pending feedback.")?;
    let Some((cursor, payload)) = selected else {
        return Ok(None);
    };
    let payload: Submission =
        serde_json::from_str(&payload).map_err(|_| "Invalid pending feedback.")?;
    let attempt = format!("{:032x}", rand::random::<u128>());
    transaction.execute(
        "UPDATE feedback_jobs SET state='working',attempt=?1,starting_revision=?2,lease_until=unixepoch()+60 WHERE cursor=?3",
        params![attempt, current_revision, cursor],
    ).map_err(|_| "Cannot save feedback claim.")?;
    let stale = payload.revision != current_revision;
    Ok(Some(Job {
        cursor,
        attempt,
        event: Event {
            cursor: cursor as u64,
            submission: payload,
        },
        current_revision,
        stale,
    }))
}

struct Completion {
    state: String,
    attempt: Option<String>,
    starting_revision: Option<String>,
    completion: Option<String>,
    reply_cursor: Option<i64>,
}

impl Completion {
    fn completed(&self, finish: &Finish, encoded: &str) -> Result<bool> {
        if self.attempt.as_deref() != Some(&finish.attempt) {
            return Err("Feedback lease is invalid or expired.");
        }
        if ["answered", "updated"].contains(&self.state.as_str()) {
            if self.completion.as_deref() != Some(encoded) {
                return Err("Feedback already has a different completion.");
            }
            return Ok(true);
        }
        if self.state != "working" {
            return Err("Feedback lease is invalid or expired.");
        }
        Ok(false)
    }
}

fn completion(connection: &Connection, finish: &Finish) -> Result<Completion> {
    connection.query_row("SELECT state,attempt,starting_revision,completion,reply_cursor FROM feedback_jobs WHERE cursor=?1",
        [finish.cursor], |row| Ok(Completion { state: row.get(0)?, attempt: row.get(1)?, starting_revision: row.get(2)?,
            completion: row.get(3)?, reply_cursor: row.get(4)? }))
        .map_err(|_| "Feedback lease is invalid or expired.")
}
