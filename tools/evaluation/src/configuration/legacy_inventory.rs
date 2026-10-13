//! Inventory of the captured default shared installer, not permission to activate it.
use super::{LegacyInstallation, LegacyLink, legacy_layout, legacy_settings};
use anyhow::{Result, ensure};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LegacyBoundary {
    AgentmemoryServiceRetirement,
    ReviewPublicationIntegration,
    RetainHerdr,
    PreserveState,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LegacyArtifactLocation {
    Home,
    Source,
}

#[derive(Clone, Debug)]
pub struct LegacyArtifact {
    /// An inventory entry relative to `location`, never a removal instruction.
    pub destination: PathBuf,
    pub location: LegacyArtifactLocation,
    pub boundary: LegacyBoundary,
}

pub struct LegacyInventory {
    pub installation: LegacyInstallation,
    /// Explicitly outside the link/settings transaction. No service or state operations run here.
    pub outside_switch: Vec<LegacyArtifact>,
}

/// Inventory the captured default layout without inspecting an installed home or running tools.
/// The caller authorizes the exact historical Pi example and mise executable paths;
/// do not infer that authority by reading an arbitrary installed symlink's target.
/// Runtime targets need not still exist. Custom installer layouts require a separate inventory.
pub fn shared_legacy_inventory(
    source: &Path,
    pi_subagent_source: &Path,
    agentmemory_executable: &Path,
) -> Result<LegacyInventory> {
    validate_source(source)?;
    for path in [pi_subagent_source, agentmemory_executable] {
        absolute_target(path)?;
    }
    Ok(LegacyInventory {
        installation: LegacyInstallation {
            source: source.to_owned(),
            links: legacy_layout::links(source, pi_subagent_source, agentmemory_executable),
            settings: legacy_settings::claims()?,
            settings_links: vec![LegacyLink {
                destination: ".claude/settings.json".into(),
                target: source.join("harnesses/claude/settings.json"),
            }],
        },
        outside_switch: boundaries(),
    })
}

pub(super) fn absolute_target(path: &Path) -> Result<()> {
    ensure!(
        path.is_absolute() && path.parent().is_some(),
        "Historical runtime path must be absolute and non-root"
    );
    super::relative(path.strip_prefix("/")?)?;
    Ok(())
}

pub(super) fn validate_source(source: &Path) -> Result<()> {
    super::absolute_directory(source)?;
    ensure!(
        source.canonicalize()?.as_os_str() == source.as_os_str(),
        "Legacy source must be canonical"
    );
    Ok(())
}

const BOUNDARY_GROUPS: &[(LegacyBoundary, &[&str])] = &[
    (
        LegacyBoundary::AgentmemoryServiceRetirement,
        &[
            ".agentmemory/iii-config.yaml",
            "Library/LaunchAgents/dev.agentmemory.plist",
            ".config/systemd/user/agentmemory.service",
        ],
    ),
    (
        LegacyBoundary::ReviewPublicationIntegration,
        &[
            ".review-publication",
            ".local/bin/review-publication",
            "Library/LaunchAgents/dev.review-publication.plist",
            ".config/systemd/user/review-publication.socket",
            ".config/systemd/user/review-publication@.service",
        ],
    ),
    (
        LegacyBoundary::PreserveState,
        &[
            ".agentmemory/service-install-state",
            "Library/Application Support/agentmemory",
            ".local/share/agentmemory",
            "data",
        ],
    ),
];

fn boundaries() -> Vec<LegacyArtifact> {
    BOUNDARY_GROUPS
        .iter()
        .flat_map(|(boundary, paths)| {
            paths.iter().map(move |path| LegacyArtifact {
                destination: path.into(),
                location: LegacyArtifactLocation::Home,
                boundary: boundary.clone(),
            })
        })
        .collect()
}
