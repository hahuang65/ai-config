use crate::model::{self, Event, PAGE_SIZE, Page, Submission};
use crate::paths::{Paths, Result, private_file};
use rusqlite::{Connection, OptionalExtension, params};

const MAX_EVENTS: u64 = 10_000;

pub struct Store(pub(crate) Connection);

impl Store {
    pub fn open(paths: &Paths) -> Result<Self> {
        let path = paths.directory.join("events.sqlite");
        private_file(&path)?;
        let connection = Connection::open(path).map_err(|_| "Cannot open event history.")?;
        connection
            .execute_batch(
                "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
             CREATE TABLE IF NOT EXISTS events (
               cursor INTEGER PRIMARY KEY AUTOINCREMENT,
               id TEXT NOT NULL UNIQUE, payload TEXT NOT NULL, action TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS finding_authorizations(id TEXT PRIMARY KEY, payload TEXT NOT NULL);
             CREATE TABLE IF NOT EXISTS configuration (
               id INTEGER PRIMARY KEY CHECK(id=1), findings TEXT NOT NULL
             );",
            )
            .map_err(|_| "Cannot initialize event history.")?;
        crate::feedback_store::initialize(&connection)?;
        Ok(Self(connection))
    }

    fn review_state(&self) -> Result<(String, Option<String>)> {
        let payload: Option<String> = self.0.query_row(
            "SELECT payload FROM events WHERE action IN ('approve','decline','reopen') ORDER BY cursor DESC LIMIT 1",
            [], |row| row.get(0),
        ).optional().map_err(|_| "Cannot read review status.")?;
        let outcome: Option<Submission> = payload
            .map(|payload| serde_json::from_str(&payload))
            .transpose()
            .map_err(|_| "Invalid saved outcome.")?;
        Ok(match outcome {
            Some(event) if event.action == "approve" => ("approved".into(), Some(event.revision)),
            Some(event) if event.action == "decline" => ("declined".into(), None),
            _ => ("open".into(), None),
        })
    }

    pub(crate) fn status(&self) -> Result<String> {
        self.review_state().map(|(status, _)| status)
    }

    pub fn reopen(&mut self) -> Result<()> {
        if self.status()? == "open" {
            return Ok(());
        }
        let submission = Submission {
            id: format!("reopen-{:032x}", rand::random::<u128>()),
            action: "reopen".into(),
            revision: String::new(),
            message: String::new(),
            annotations: vec![],
            finding: None,
        };
        self.append(&submission)?;
        Ok(())
    }

    pub fn submit(&mut self, paths: &Paths, submission: &Submission) -> Result<u64> {
        submission.validate()?;
        let payload = serde_json::to_string(submission).map_err(|_| "Cannot encode feedback.")?;
        let existing: Option<(u64, String)> = self
            .0
            .query_row(
                "SELECT cursor, payload FROM events WHERE id=?1",
                [&submission.id],
                |row| Ok((row.get::<_, i64>(0)? as u64, row.get(1)?)),
            )
            .optional()
            .map_err(|_| "Cannot read event history.")?;
        if let Some((cursor, previous)) = existing {
            return if previous == payload {
                Ok(cursor)
            } else {
                Err("Submission ID already has different content.")
            };
        }
        if submission.action != "reply" && self.status()? != "open" {
            return Err("Review is closed. Use open FILE for another review.");
        }
        self.validate_finding_decision(paths, submission)?;
        if submission.action == "approve" && model::revision(paths)? != submission.revision {
            return Err("Artifact changed. Review the current version before approval.");
        }
        self.append(submission)
    }

    fn append(&mut self, submission: &Submission) -> Result<u64> {
        let transaction = self
            .0
            .transaction()
            .map_err(|_| "Cannot start feedback transaction.")?;
        let cursor = append_event(&transaction, submission)?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit feedback. Nothing was acknowledged.")?;
        Ok(cursor)
    }

    fn latest(&self) -> Result<u64> {
        self.0
            .query_row("SELECT COALESCE(MAX(cursor),0) FROM events", [], |row| {
                row.get::<_, i64>(0).map(|cursor| cursor as u64)
            })
            .map_err(|_| "Cannot read event cursor.")
    }

    pub fn has_update(&self, cursor: u64) -> Result<bool> {
        let latest = self.latest()?;
        if cursor > latest {
            return Err("Cursor is ahead of this review history.");
        }
        Ok(cursor < latest
            || self.status()? != "open"
            || self
                .finding_review(None)?
                .is_some_and(|review| review.complete()))
    }

    pub fn page(&self, cursor: u64, paths: &Paths) -> Result<Page> {
        let latest = self.latest()?;
        if cursor > latest {
            return Err("Cursor is ahead of this review history.");
        }
        let mut statement = self
            .0
            .prepare("SELECT cursor,payload FROM events WHERE cursor>?1 ORDER BY cursor LIMIT ?2")
            .map_err(|_| "Cannot read event history.")?;
        let rows = statement
            .query_map(params![cursor as i64, PAGE_SIZE as i64], |row| {
                Ok((row.get::<_, i64>(0)? as u64, row.get::<_, String>(1)?))
            })
            .map_err(|_| "Cannot read event history.")?;
        let mut events = Vec::new();
        for row in rows {
            let (cursor, payload) = row.map_err(|_| "Cannot read event.")?;
            let submission = serde_json::from_str(&payload).map_err(|_| "Invalid saved event.")?;
            events.push(Event { cursor, submission });
        }
        let cursor = events.last().map_or(cursor, |event| event.cursor);
        let (mut status, approved_revision) = self.review_state()?;
        let current_revision = model::revision(paths).ok();
        let needs_review = approved_revision.is_none() || current_revision != approved_revision;
        let finding_review = self.finding_review(current_revision.as_deref())?;
        if status == "open"
            && finding_review
                .as_ref()
                .is_some_and(|review| review.complete())
        {
            status = "decided".into();
        }
        Ok(Page {
            cursor,
            status,
            approved_revision,
            current_revision,
            needs_review,
            events,
            more: cursor < latest,
            finding_review,
            processing: Some(self.feedback_processing()?),
        })
    }
}

pub(crate) fn append_event(
    transaction: &rusqlite::Transaction<'_>,
    submission: &Submission,
) -> Result<u64> {
    let latest: i64 = transaction
        .query_row("SELECT COALESCE(MAX(cursor),0) FROM events", [], |row| {
            row.get(0)
        })
        .map_err(|_| "Cannot read event cursor.")?;
    if latest as u64 >= MAX_EVENTS {
        return Err(
            "Event history limit reached. Preserve this history before starting a new storage root.",
        );
    }
    let payload = serde_json::to_string(submission).map_err(|_| "Cannot encode feedback.")?;
    transaction
        .execute(
            "INSERT INTO events(id,payload,action) VALUES(?1,?2,?3)",
            params![submission.id, payload, submission.action],
        )
        .map_err(|_| "Cannot persist feedback. Nothing was acknowledged.")?;
    let cursor = transaction.last_insert_rowid();
    if ["feedback", "accept", "reject", "approve", "decline"].contains(&submission.action.as_str())
    {
        transaction
            .execute("INSERT INTO feedback_jobs(cursor) VALUES(?1)", [cursor])
            .map_err(|_| "Cannot queue feedback. Nothing was acknowledged.")?;
    }
    Ok(cursor as u64)
}
