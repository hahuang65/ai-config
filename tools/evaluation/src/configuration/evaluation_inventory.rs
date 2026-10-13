//! The evaluation launchers are separate from its retained private profile and Herdr state.
use super::legacy_inventory::{absolute_target, validate_source};
use super::{
    LegacyArtifact, LegacyArtifactLocation, LegacyBoundary, LegacyInstallation, LegacyInventory,
    LegacyLink,
};
use anyhow::{Result, ensure};
use std::path::Path;

/// Describe the old evaluation installer's CLI links without reading `.state/pi`.
/// The caller authorizes the historical executable and tool source paths explicitly.
/// Herdr remains independent; this inventory never claims its launcher or state.
pub fn evaluation_legacy_inventory(
    source: &Path,
    executable: &Path,
    worktree_source: &Path,
    worklog_source: &Path,
) -> Result<LegacyInventory> {
    validate_source(source)?;
    for target in [executable, worktree_source, worklog_source] {
        absolute_target(target)?;
    }
    ensure!(
        executable.starts_with(source),
        "Historical evaluation executable must be inside its source"
    );
    let links = [
        ("pi-minimal", executable.to_owned()),
        ("review-change-eval", executable.to_owned()),
        ("artifact-review", source.join("bin/artifact-review")),
        ("wt", worktree_source.join("target/release/wt")),
        ("wl", worklog_source.join("target/release/wl")),
    ]
    .into_iter()
    .map(|(name, target)| LegacyLink {
        destination: format!(".local/bin/{name}").into(),
        target,
    })
    .collect();
    Ok(LegacyInventory {
        installation: LegacyInstallation {
            source: source.to_owned(),
            links,
            settings: vec![],
            settings_links: vec![],
        },
        outside_switch: boundaries(),
    })
}

fn boundaries() -> Vec<LegacyArtifact> {
    use LegacyArtifactLocation::{Home, Source};
    use LegacyBoundary::{PreserveState, RetainHerdr};
    [
        (Home, RetainHerdr, ".local/bin/herdr-eval"),
        (Source, PreserveState, ".state/pi"),
        (Source, RetainHerdr, ".state/config"),
        (Source, RetainHerdr, ".state/data"),
        (Source, RetainHerdr, ".state/state"),
        (Source, RetainHerdr, ".state/cache"),
        (Home, PreserveState, ".worklog"),
        (Home, PreserveState, ".worktrees"),
    ]
    .into_iter()
    .map(|(location, boundary, destination)| LegacyArtifact {
        location,
        boundary,
        destination: destination.into(),
    })
    .collect()
}
