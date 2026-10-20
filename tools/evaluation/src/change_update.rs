//! Replace current report files without retaining or replaying failed updates.
use crate::{
    change_store::{self, Store},
    change_types::Report,
};
use anyhow::{Result, ensure};
use serde_json::Value;
use std::{collections::BTreeMap, io::Write, path::Path};

pub(crate) fn replace(
    store: &Store,
    directory: &Path,
    report: Report,
    html: String,
    objects: BTreeMap<String, Value>,
) -> Result<()> {
    ensure!(
        objects.keys().all(|name| matches!(
            name.as_str(),
            "response-settings.json" | "source-context.json" | "publication-scope.json"
        )),
        "Invalid report update metadata"
    );
    store.replace_report(directory, &report, &html)?;
    for (name, value) in objects {
        store.replace_object(directory, &name, &value)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "../tests/support/current_update.rs"]
mod tests;

pub(crate) fn atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    if path.try_exists()? {
        change_store::read(path, crate::change_types::MAX_REPORT_BYTES)?;
    }
    let directory = path
        .parent()
        .ok_or_else(|| anyhow::anyhow!("Missing update directory"))?;
    let mut temporary = tempfile::NamedTempFile::new_in(directory)?;
    temporary.write_all(bytes)?;
    temporary.as_file().sync_all()?;
    temporary.persist(path).map_err(|error| error.error)?;
    std::fs::File::open(directory)?.sync_all()?;
    Ok(())
}
