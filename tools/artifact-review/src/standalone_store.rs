use crate::{
    feedback::Job,
    feedback_jobs::take_job,
    feedback_store::expire,
    model::revision,
    paths::{Paths, Result},
    store::Store,
};

impl Store {
    pub fn configure_standalone(&mut self, paths: &Paths) -> Result<()> {
        if self.feedback_origin()?.is_some() {
            return Err("An attached agent owns this review.");
        }
        let binding = self
            .finding_binding()?
            .ok_or("Standalone responses require a retained change report.")?;
        if !binding.read_only {
            return Err("Standalone response mode must prohibit source repairs.");
        }
        evaluation::feedback_response::verify(
            &paths.artifact,
            &binding.report_digest,
            &binding.revision,
        )
        .map_err(|_| "Retained responder settings are unavailable. Generate a fresh review.")?;
        self.0
            .execute(
                "INSERT OR IGNORE INTO feedback_responder(id,kind) VALUES(1,'standalone')",
                [],
            )
            .map_err(|_| "Cannot configure standalone responder.")?;
        Ok(())
    }

    pub(crate) fn standalone_enabled(&self) -> Result<bool> {
        self.0
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM feedback_responder WHERE id=1 AND kind='standalone')",
                [],
                |row| row.get(0),
            )
            .map_err(|_| "Cannot read responder configuration.")
    }

    pub(crate) fn claim_standalone(&mut self, paths: &Paths) -> Result<Option<Job>> {
        if !self.standalone_enabled()? {
            return Ok(None);
        }
        self.refresh_current_report(paths)?;
        let current = revision(paths)?;
        let transaction = self
            .0
            .transaction()
            .map_err(|_| "Cannot claim standalone feedback.")?;
        expire(&transaction)?;
        let job = take_job(&transaction, current, false)?;
        transaction
            .commit()
            .map_err(|_| "Cannot commit standalone claim.")?;
        Ok(job)
    }

    pub(crate) fn refresh_current_report(&self, paths: &Paths) -> Result<()> {
        let previous = self
            .finding_binding()?
            .ok_or("Missing report configuration.")?;
        let mut current =
            crate::findings::Binding::read(&paths.artifact.with_file_name("report.json"))?;
        current.read_only = previous.read_only;
        if current == previous {
            return Ok(());
        }
        if current.publication_only != previous.publication_only
            || current
                .items
                .iter()
                .map(|item| &item.id)
                .ne(previous.items.iter().map(|item| &item.id))
        {
            return Err("Report update changed finding authority.");
        }
        evaluation::feedback_response::verify(
            &paths.artifact,
            &current.report_digest,
            &current.revision,
        )
        .map_err(|_| "Current report update is not verified.")?;
        let encoded =
            serde_json::to_string(&current).map_err(|_| "Cannot encode current report.")?;
        self.0
            .execute("UPDATE configuration SET findings=?1 WHERE id=1", [encoded])
            .map_err(|_| "Cannot refresh current report.")?;
        Ok(())
    }

    pub(crate) fn retry_standalone(&self, cursor: i64) -> Result<()> {
        if cursor <= 0 || !self.standalone_enabled()? {
            return Err("Only standalone feedback can be retried here.");
        }
        let changed = self.0.execute("UPDATE feedback_jobs SET state='queued',attempt=NULL,lease_until=NULL WHERE cursor=?1 AND state='needs_attention'", [cursor])
            .map_err(|_| "Cannot retry saved feedback.")?;
        if changed == 1 {
            return Ok(());
        }
        let state: String = self
            .0
            .query_row(
                "SELECT state FROM feedback_jobs WHERE cursor=?1",
                [cursor],
                |row| row.get(0),
            )
            .map_err(|_| "Unknown feedback event.")?;
        if ["queued", "working", "answered", "updated"].contains(&state.as_str()) {
            Ok(())
        } else {
            Err("Feedback cannot be retried.")
        }
    }

    pub(crate) fn fail_queued(&self) {
        let _ = self.0.execute(
            "UPDATE feedback_jobs SET state='needs_attention' WHERE state='queued'",
            [],
        );
    }
}
