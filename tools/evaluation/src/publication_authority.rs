//! Publication authorization survives wording changes, not a different reviewed source scope.
use crate::{change_post, change_store::Store, change_types::Report, publication::Selected};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::path::Path;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Binding {
    report_digest: String,
    source_scope: String,
}

fn scope(report: &Report) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(&report.scope, &report.digest))?)
    ))
}

pub(crate) fn matches(
    store: &Store,
    directory: &Path,
    report: &Report,
    authorized: &str,
) -> Result<bool> {
    if change_post::digest(report)? == authorized {
        return Ok(true);
    }
    if !directory.join("publication-scope.json").try_exists()? {
        return Ok(false);
    }
    let binding: Binding = store.load_object(directory, "publication-scope.json")?;
    Ok(binding.report_digest == authorized && binding.source_scope == scope(report)?)
}

pub(crate) fn carry(selected: &Selected) -> Result<Option<Value>> {
    let directory = &selected.directory;
    let authorized = if directory.join("receipt.json").try_exists()? {
        selected
            .store
            .load_object::<change_post::Receipt>(directory, "receipt.json")?
            .report_digest
    } else if directory.join("attempt.json").try_exists()? {
        selected
            .store
            .load_object::<change_post::Attempt>(directory, "attempt.json")?
            .report_digest
    } else {
        return Ok(None);
    };
    ensure!(
        matches(&selected.store, directory, &selected.report, &authorized)?,
        "Publication authority does not match this source scope"
    );
    Ok(Some(serde_json::to_value(Binding {
        report_digest: authorized,
        source_scope: scope(&selected.report)?,
    })?))
}
