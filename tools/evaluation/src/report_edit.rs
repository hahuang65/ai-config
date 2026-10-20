use crate::{
    change_html, change_post,
    change_types::{self, Explanation, Report},
    change_update, publication,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Revision {
    pub summary: Option<String>,
    #[serde(default)]
    pub findings: Vec<FindingEdit>,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct FindingEdit {
    id: String,
    title: Option<String>,
    explanation: Option<Explanation>,
}

#[derive(Serialize)]
pub struct Current {
    pub revision: String,
    pub report_digest: String,
}

pub fn record(html: &Path, digest: &str, revision: &str) -> Result<Value> {
    Ok(serde_json::to_value(
        publication::selected(html, digest, revision)?.report,
    )?)
}

impl Revision {
    pub(crate) fn validate(&self) -> Result<()> {
        if let Some(summary) = &self.summary {
            change_types::text(summary, 8000)?;
        }
        ensure!(self.findings.len() <= 50, "Too many finding edits");
        let mut ids = BTreeSet::new();
        for edit in &self.findings {
            ensure!(ids.insert(&edit.id), "Duplicate finding edit");
            if let Some(title) = &edit.title {
                change_types::text(title, 500)?;
            }
            if let Some(explanation) = &edit.explanation {
                for (_, section) in explanation.sections() {
                    change_types::text(section, 8000)?;
                }
                change_types::text(&explanation.body(), 8000)?;
            }
        }
        Ok(())
    }
}

pub fn apply(html: &Path, digest: &str, revision: &str, edit: &Revision) -> Result<Current> {
    edit.validate()?;
    let selected = publication::selected(html, digest, revision)?;
    let _lock = change_post::lock(&selected.directory)?;
    let selected = publication::selected(html, digest, revision)?;
    let mut report: Report = serde_json::from_value(serde_json::to_value(&selected.report)?)?;
    if let Some(summary) = &edit.summary {
        report.summary = summary.clone();
    }
    for edit in &edit.findings {
        let finding = report
            .findings
            .iter_mut()
            .find(|finding| finding.id == edit.id)
            .ok_or_else(|| anyhow::anyhow!("Unknown finding edit"))?;
        if let Some(title) = &edit.title {
            finding.proposal.title = title.clone();
        }
        if let Some(explanation) = &edit.explanation {
            finding.proposal.body = explanation.body();
            finding.proposal.explanation = Some(explanation.clone());
        }
    }
    let rendered = change_html::render(&report);
    report.html_digest = format!("{:x}", Sha256::digest(&rendered));
    let new_digest = change_post::digest(&report)?;
    let objects = metadata(&selected, &new_digest)?;
    let current = Current {
        revision: report.html_digest.clone(),
        report_digest: format!("{:x}", Sha256::digest(serde_json::to_vec(&report)?)),
    };
    change_update::replace(
        &selected.store,
        &selected.directory,
        report,
        rendered,
        objects,
    )?;
    Ok(current)
}

fn metadata(selected: &publication::Selected, digest: &str) -> Result<BTreeMap<String, Value>> {
    let mut objects = BTreeMap::new();
    for name in ["response-settings.json", "source-context.json"] {
        let mut object: Value = selected.store.load_object(&selected.directory, name)?;
        ensure!(
            object["report_digest"] == change_post::digest(&selected.report)?,
            "Report metadata changed"
        );
        object["report_digest"] = Value::String(digest.into());
        objects.insert(name.into(), object);
    }
    if let Some(binding) = crate::publication_authority::carry(selected)? {
        objects.insert("publication-scope.json".into(), binding);
    }
    Ok(objects)
}
