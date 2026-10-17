use crate::{
    findings::{Binding, Decision, Review},
    model::{self, Submission},
    paths::{Paths, Result},
    store::Store,
};
use rusqlite::OptionalExtension;
use std::collections::BTreeMap;

fn validate_same_report(previous: &str, binding: &Binding) -> Result<()> {
    let mut saved: Binding =
        serde_json::from_str(previous).map_err(|_| "Invalid finding configuration.")?;
    saved.validate()?;
    // Enrich legacy PR metadata, never rewrite events or turn publication mode into repair authority.
    saved.publication_only |= binding.publication_only;
    if saved != *binding {
        return Err(
            "Finding review is already bound to another report. Open the new report at its own path.",
        );
    }
    Ok(())
}

impl Store {
    pub fn configure_findings(&mut self, paths: &Paths, binding: &Binding) -> Result<()> {
        binding.validate()?;
        if model::revision(paths)? != binding.revision {
            return Err("Findings report does not match the artifact revision.");
        }
        let transaction = self
            .0
            .transaction()
            .map_err(|_| "Cannot configure finding review.")?;
        let previous: Option<String> = transaction
            .query_row("SELECT findings FROM configuration WHERE id=1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| "Cannot read finding configuration.")?;
        let encoded = serde_json::to_string(binding).map_err(|_| "Cannot encode findings.")?;
        if let Some(previous) = previous {
            if previous == encoded {
                return Ok(());
            }
            validate_same_report(&previous, binding)?;
            transaction
                .execute(
                    "UPDATE configuration SET findings=?1 WHERE id=1",
                    [&encoded],
                )
                .map_err(|_| "Cannot update finding mode.")?;
            return transaction
                .commit()
                .map_err(|_| "Cannot persist finding mode.");
        }
        let events: i64 = transaction
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .map_err(|_| "Cannot inspect existing review.")?;
        if events != 0 {
            return Err("Cannot change a review with existing feedback into a finding review.");
        }
        transaction
            .execute(
                "INSERT INTO configuration(id,findings) VALUES(1,?1)",
                [&encoded],
            )
            .map_err(|_| "Cannot save finding configuration.")?;
        transaction
            .commit()
            .map_err(|_| "Cannot persist finding configuration.")
    }

    fn finding_binding(&self) -> Result<Option<Binding>> {
        let saved: Option<String> = self
            .0
            .query_row("SELECT findings FROM configuration WHERE id=1", [], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|_| "Cannot read finding configuration.")?;
        saved
            .map(|source| {
                let binding: Binding =
                    serde_json::from_str(&source).map_err(|_| "Invalid finding configuration.")?;
                binding.validate()?;
                Ok(binding)
            })
            .transpose()
    }

    pub fn finding_review(&self, revision: Option<&str>) -> Result<Option<Review>> {
        let Some(binding) = self.finding_binding()? else {
            return Ok(None);
        };
        let mut decisions = BTreeMap::new();
        let mut statement = self.0.prepare("SELECT payload FROM events WHERE action IN ('accept','reject') ORDER BY cursor LIMIT 51")
            .map_err(|_| "Cannot read finding decisions.")?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|_| "Cannot read finding decisions.")?;
        for row in rows {
            let source = row.map_err(|_| "Cannot read finding decision.")?;
            let event: Submission =
                serde_json::from_str(&source).map_err(|_| "Invalid finding decision.")?;
            let id = event.finding.ok_or("Finding decision has no ID.")?;
            if event.revision != binding.revision
                || !binding.items.iter().any(|item| item.id == id)
                || decisions.insert(id, event.action).is_some()
            {
                return Err("Finding decision does not match this report.");
            }
        }
        let needs_review = revision != Some(binding.revision.as_str());
        Ok(Some(Review {
            publication_only: binding.publication_only,
            revision: binding.revision,
            report_digest: binding.report_digest,
            needs_review,
            items: binding
                .items
                .into_iter()
                .map(|label| Decision {
                    decision: decisions.remove(&label.id),
                    label,
                })
                .collect(),
        }))
    }

    pub fn validate_finding_decision(&self, paths: &Paths, submission: &Submission) -> Result<()> {
        let review = self.finding_review(None)?;
        let Some(review) = review else {
            return if submission.finding.is_some() {
                Err("This artifact is not a finding review.")
            } else {
                Ok(())
            };
        };
        if submission.action == "reply" {
            return Ok(());
        }
        if review.publication_only
            && (submission.finding.is_some() || submission.action == "approve")
        {
            return Err("Pull-request reviews select comments for publication, not repairs.");
        }
        if submission.action == "approve" {
            return Err(
                "Accept or reject each finding; whole-report approval cannot authorize repairs.",
            );
        }
        if review.complete() {
            return Err("All findings are already decided.");
        }
        let Some(id) = &submission.finding else {
            return Ok(());
        };
        let item = review
            .items
            .iter()
            .find(|item| item.label.id == *id)
            .ok_or("Unknown finding ID.")?;
        if item.decision.is_some() {
            return Err(
                "Finding already decided. A saved authorization cannot be silently replaced.",
            );
        }
        if review.revision != submission.revision || model::revision(paths)? != review.revision {
            return Err("Report changed. Obtain a fresh review before deciding findings.");
        }
        Ok(())
    }
}
