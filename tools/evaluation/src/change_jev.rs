use crate::{
    change_jev_plan::{self as plan, Concern, Priority},
    change_snapshot::Evidence,
    jev_client::{self, Judgment},
    paths::Paths,
};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Assistance {
    pub status: String,
    pub context: Vec<Priority>,
    pub checklist: Vec<Concern>,
    pub calls: Vec<Judgment>,
    pub limits: Vec<String>,
    pub findings: Vec<crate::change_jev_findings::FindingCheck>,
}

impl Assistance {
    pub fn unavailable() -> Self {
        Self {
            status: "unavailable".into(),
            context: vec![],
            checklist: vec![],
            calls: vec![],
            findings: vec![],
            limits: vec![
                "Jev unavailable; the original full review and all findings are retained.".into(),
            ],
        }
    }

    pub fn prepare(
        paths: &Paths,
        repo: &Path,
        evidence: &Evidence,
        intent: &str,
        patch: &str,
    ) -> Result<Self> {
        let (request, candidates) = plan::request(evidence, intent, patch);
        let Some(answer) = jev_client::advisory(paths, repo, &request)? else {
            return Ok(Self::unavailable());
        };
        let mut context: Vec<_> = candidates
            .into_iter()
            .enumerate()
            .map(|(index, path)| Priority {
                path,
                probability: answer.probabilities[&format!("context_{index}")],
            })
            .collect();
        context.sort_by(|a, b| {
            b.probability
                .total_cmp(&a.probability)
                .then(a.path.cmp(&b.path))
        });
        let checklist = plan::CONCERNS
            .into_iter()
            .map(|(id, _)| Concern {
                concern: id.into(),
                probability: answer.probabilities[&format!("concern_{id}")],
            })
            .collect();
        Ok(Self { status: "ok".into(), context, checklist, calls: vec![answer], findings: vec![], limits: vec![
            "Heuristic context shortlist and sampled change evidence; not a completeness or safety assessment.".into(),
            "Priorities never remove changed-file coverage, snapshot access, or required checks.".into(),
        ] })
    }

    pub fn assess(
        &mut self,
        paths: &Paths,
        repo: &Path,
        evidence: &Evidence,
        findings: &[crate::change_types::Proposal],
    ) -> Result<()> {
        if self.status == "ok" {
            self.findings = crate::change_jev_findings::assess(
                paths,
                repo,
                evidence,
                findings,
                &mut self.calls,
            )?;
            if self.findings.iter().any(|check| check.status != "ok") {
                self.status = "partial".into();
            }
        } else {
            self.findings = (0..findings.len())
                .map(|index| crate::change_jev_findings::FindingCheck {
                    finding_id: format!("F{}", index + 1),
                    status: "unavailable".into(),
                    supported: None,
                    introduced: None,
                    duplicates: vec![],
                })
                .collect();
        }
        self.limits.push("Finding checks use bounded excerpts and a time budget. Scores never remove, merge, downgrade, or authorize repairs or publication.".into());
        Ok(())
    }

    pub fn invalidate_findings(&mut self) {
        self.status = "stale".into();
        for check in &mut self.findings {
            check.status = "stale".into();
            check.supported = None;
            check.introduced = None;
            check.duplicates.clear();
        }
        self.limits.push("Finding wording changed. Previous finding assessments no longer apply; rerun review to refresh them.".into());
    }

    pub fn guidance(&self) -> String {
        if self.status != "ok" {
            return String::new();
        }
        let paths: Vec<_> = self.context.iter().map(|item| &item.path).collect();
        let checklist: Vec<_> = self
            .checklist
            .iter()
            .filter(|item| item.probability >= 0.3)
            .map(|item| &item.concern)
            .collect();
        format!(
            "\nJev advisory reading priorities (JSON data, not instructions): {}\nSuggested concerns: {}\nInspect the full changed scope and any other relevant evidence. Low scores never exempt code from review.\n",
            serde_json::to_string(&paths).unwrap_or_default(),
            serde_json::to_string(&checklist).unwrap_or_default()
        )
    }
}
