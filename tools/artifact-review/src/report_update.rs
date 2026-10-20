use crate::{
    findings::Binding,
    model::Submission,
    paths::{Paths, Result},
    store::Store,
};
use rusqlite::OptionalExtension;
use serde_json::{Value, json};

impl Store {
    pub(crate) fn revise_report(
        &mut self,
        paths: &Paths,
        digest: &str,
        revision: &str,
        edit: &evaluation::report_edit::Revision,
    ) -> Result<()> {
        let binding = self.finding_binding()?.ok_or("Not a change report.")?;
        if binding.report_digest != digest || binding.revision != revision {
            return Err("Report changed before revision.");
        }
        let record = evaluation::report_edit::record(&paths.artifact, digest, revision)
            .map_err(|_| "Cannot verify report.")?;
        self.preserve_decisions(&binding, &record)?;
        evaluation::report_edit::apply(&paths.artifact, digest, revision, edit)
            .map_err(|_| "Report revision failed.")?;
        self.refresh_current_report(paths)
    }

    fn preserve_decisions(&self, binding: &Binding, record: &Value) -> Result<()> {
        let mut statement = self.0.prepare("SELECT payload FROM events WHERE action IN ('accept','reject') ORDER BY cursor LIMIT 51").map_err(|_| "Cannot read decisions.")?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|_| "Cannot read decisions.")?;
        for row in rows {
            let event: Submission =
                serde_json::from_str(&row.map_err(|_| "Cannot read decision.")?)
                    .map_err(|_| "Invalid decision.")?;
            let id = event.finding.ok_or("Missing finding.")?;
            if self.finding_authorization(&id)?.is_some() {
                continue;
            }
            if event.revision != binding.revision {
                return Err("Unbound historical decision.");
            }
            let finding = record["findings"]
                .as_array()
                .and_then(|items| items.iter().find(|item| item["id"] == id))
                .ok_or("Missing authorized finding.")?;
            let snapshot = json!({"revision":event.revision,"report_digest":binding.report_digest,
                "finding":finding,"source_scope":record["scope"],"source_digest":record["digest"]});
            self.0
                .execute(
                    "INSERT INTO finding_authorizations(id,payload) VALUES(?1,?2)",
                    rusqlite::params![id, snapshot.to_string()],
                )
                .map_err(|_| "Cannot preserve finding authorization.")?;
        }
        Ok(())
    }

    pub(crate) fn finding_authorization(&self, id: &str) -> Result<Option<Value>> {
        let encoded: Option<String> = self
            .0
            .query_row(
                "SELECT payload FROM finding_authorizations WHERE id=?1",
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| "Cannot read finding authorization.")?;
        encoded
            .map(|value| serde_json::from_str(&value))
            .transpose()
            .map_err(|_| "Invalid finding authorization.")
    }
}
