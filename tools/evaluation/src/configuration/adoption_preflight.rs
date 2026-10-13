//! Read-only rehearsal of the same link and settings plan used during adoption.
use super::{
    LegacyInstallation, Manifest, absolute_directory, check_previous_destinations, check_sources,
    document, plan, prior_state, settings_files, targets,
};
use anyhow::Result;
use std::path::Path;

/// Inspect the complete adoption plan without locking or writing HOME.
/// Advisory only: the installer repeats every check under its lock before changing files.
pub fn inspect(home: &Path, manifest: &Manifest, legacy: &LegacyInstallation) -> Result<()> {
    absolute_directory(home)?;
    let desired = targets(manifest)?;
    document::object(&serde_json::to_vec(manifest)?)?;
    check_sources(home, manifest, &desired)?;
    let record = home.join(".local/state/ai-config/installation.json");
    let previous = prior_state(home, &record, Some(legacy))?;
    check_previous_destinations(home, &manifest.source, &previous)?;
    plan(home, &previous.links, &desired)?;
    settings_files::plan_with_links(
        home,
        &previous.settings,
        &manifest.settings,
        &previous.settings_links,
    )?;
    Ok(())
}
