use crate::model::{self, Event, PAGE_SIZE, Page, Submission};
use crate::paths::{Paths, Result, private_file};
use rusqlite::{Connection, OptionalExtension, params};

const MAX_EVENTS: u64 = 10_000;

pub struct Store(Connection);

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
             );",
            )
            .map_err(|_| "Cannot initialize event history.")?;
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

    fn status(&self) -> Result<String> {
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
        if submission.action == "approve" && model::snapshot(paths)?.revision != submission.revision
        {
            return Err("Artifact changed. Review the current version before approval.");
        }
        self.append(submission)
    }

    fn append(&mut self, submission: &Submission) -> Result<u64> {
        if self.latest()? >= MAX_EVENTS {
            return Err(
                "Event history limit reached. Preserve this history before starting a new storage root.",
            );
        }
        let payload = serde_json::to_string(submission).map_err(|_| "Cannot encode feedback.")?;
        self.0
            .execute(
                "INSERT INTO events(id,payload,action) VALUES(?1,?2,?3)",
                params![submission.id, payload, submission.action],
            )
            .map_err(|_| "Cannot persist feedback. Nothing was acknowledged.")?;
        Ok(self.0.last_insert_rowid() as u64)
    }

    fn latest(&self) -> Result<u64> {
        self.0
            .query_row("SELECT COALESCE(MAX(cursor),0) FROM events", [], |row| {
                row.get::<_, i64>(0).map(|cursor| cursor as u64)
            })
            .map_err(|_| "Cannot read event cursor.")
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
        let (status, approved_revision) = self.review_state()?;
        let current_revision = model::snapshot(paths)
            .ok()
            .map(|snapshot| snapshot.revision);
        let needs_review = approved_revision.is_none() || current_revision != approved_revision;
        Ok(Page {
            cursor,
            status,
            approved_revision,
            current_revision,
            needs_review,
            events,
            more: cursor < latest,
        })
    }
}
