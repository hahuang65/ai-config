use crate::{
    feedback::{Origin, Processing},
    paths::Result,
    store::Store,
};
use rusqlite::{Connection, OptionalExtension};

pub fn initialize(connection: &Connection) -> Result<()> {
    connection
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS feedback_origin (
           id INTEGER PRIMARY KEY CHECK(id=1), origin TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS feedback_jobs (
           cursor INTEGER PRIMARY KEY REFERENCES events(cursor),
           state TEXT NOT NULL DEFAULT 'queued',
           attempt TEXT,
           starting_revision TEXT,
           lease_until INTEGER,
           completion TEXT,
           reply_cursor INTEGER
         );
         CREATE TABLE IF NOT EXISTS feedback_responder (id INTEGER PRIMARY KEY CHECK(id=1), kind TEXT NOT NULL CHECK(kind='standalone'));
         CREATE TABLE IF NOT EXISTS feedback_ticket (id INTEGER PRIMARY KEY CHECK(id=1), ticket TEXT NOT NULL, expires INTEGER NOT NULL);
         DELETE FROM feedback_ticket;
         UPDATE feedback_jobs SET state='needs_attention',lease_until=NULL WHERE state='working';",
        )
        .map_err(|_| "Cannot initialize feedback processing.")
}

impl Store {
    pub fn attach_feedback(&mut self, paths: &crate::paths::Paths, origin: Origin) -> Result<()> {
        self.attach_feedback_with_ticket(paths, origin, None)
    }

    pub fn attach_feedback_with_ticket(
        &mut self,
        paths: &crate::paths::Paths,
        origin: Origin,
        ticket: Option<&str>,
    ) -> Result<()> {
        if self.standalone_enabled()? {
            return Err("Standalone reviews cannot attach another responder.");
        }
        let origin = origin.validated()?;
        let encoded =
            serde_json::to_string(&origin).map_err(|_| "Cannot encode feedback origin.")?;
        let transaction = self
            .0
            .transaction()
            .map_err(|_| "Cannot attach feedback origin.")?;
        let previous: Option<String> = transaction
            .query_row("SELECT origin FROM feedback_origin WHERE id=1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| "Cannot read feedback origin.")?;
        match previous {
            Some(previous) if previous != encoded => {
                return Err("Review is attached to another conversation.");
            }
            Some(_) => (),
            None => {
                if let Some(ticket) = ticket {
                    crate::feedback_ticket::validate(&transaction, ticket)?;
                }
                transaction
                    .execute(
                        "INSERT INTO feedback_origin(id,origin) VALUES(1,?1)",
                        [&encoded],
                    )
                    .map_err(|_| "Cannot save feedback origin.")?;
            }
        }
        crate::feedback_registry::register(paths, &origin)?;
        if ticket.is_some() {
            transaction
                .execute("DELETE FROM feedback_ticket WHERE id=1", [])
                .map_err(|_| "Cannot consume attachment receipt.")?;
        }
        transaction
            .commit()
            .map_err(|_| "Cannot commit feedback origin.")
    }

    pub(crate) fn feedback_origin(&self) -> Result<Option<Origin>> {
        let origin: Option<String> = self
            .0
            .query_row("SELECT origin FROM feedback_origin WHERE id=1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| "Cannot read feedback origin.")?;
        origin
            .map(|encoded| serde_json::from_str::<Origin>(&encoded))
            .transpose()
            .map_err(|_| "Invalid saved feedback origin.")
    }

    pub fn feedback_processing(&self) -> Result<Processing> {
        expire(&self.0)?;
        let pending: u64 = self.0.query_row(
            "SELECT COUNT(*) FROM feedback_jobs WHERE state IN ('queued','working','needs_attention')", [],
            |row| row.get::<_, i64>(0).map(|count| count as u64),
        ).map_err(|_| "Cannot read feedback queue.")?;
        let state = self.0.query_row(
            "SELECT state FROM feedback_jobs ORDER BY CASE state WHEN 'working' THEN 0 WHEN 'needs_attention' THEN 1
             WHEN 'queued' THEN 2 ELSE 3 END, cursor DESC LIMIT 1", [], |row| row.get(0),
        ).optional().map_err(|_| "Cannot read feedback status.")?.unwrap_or_else(|| "idle".into());
        let responder = if self.standalone_enabled()? {
            Some("standalone".into())
        } else {
            self.feedback_origin()?.map(|origin| origin.harness)
        };
        let retry_cursor = if responder.as_deref() == Some("standalone")
            && state == "needs_attention"
        {
            self.0.query_row("SELECT cursor FROM feedback_jobs WHERE state='needs_attention' ORDER BY cursor LIMIT 1", [], |row| row.get(0))
                .optional().map_err(|_| "Cannot inspect interrupted feedback.")?
        } else {
            None
        };
        Ok(Processing {
            state,
            pending,
            responder,
            retry_cursor,
        })
    }
}

pub(crate) fn expire(connection: &Connection) -> Result<()> {
    connection.execute("UPDATE feedback_jobs SET state='needs_attention' WHERE state='working' AND lease_until<=unixepoch()", [])
        .map_err(|_| "Cannot recover interrupted feedback.")?;
    Ok(())
}
