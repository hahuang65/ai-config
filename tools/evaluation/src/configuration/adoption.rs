//! Explicit, caller-supplied legacy ownership; no directory scanning or prefix adoption.
use super::{Manifest, Setting, Targets};
use anyhow::{Result, ensure};
use std::path::{Path, PathBuf};

#[derive(Clone, Debug)]
pub struct LegacyLink {
    pub destination: PathBuf,
    pub target: PathBuf,
}

#[derive(Clone, Debug)]
pub struct LegacyInstallation {
    pub source: PathBuf,
    pub links: Vec<LegacyLink>,
    pub settings: Vec<Setting>,
    pub settings_links: Vec<LegacyLink>,
}

/// Adopt only a caller-authorized legacy inventory during the first switch.
/// Ordinary switching never infers legacy ownership from matching content.
pub fn adopt_configuration(
    home: &Path,
    manifest: &Manifest,
    legacy: &LegacyInstallation,
) -> Result<()> {
    super::switch(home, manifest, Some(legacy))
}

#[derive(Default)]
pub(super) struct Previous {
    pub links: Targets,
    pub settings: Vec<Setting>,
    pub settings_links: Targets,
}

pub(super) fn previous(home: &Path, legacy: &LegacyInstallation) -> Result<Previous> {
    ensure!(
        legacy.source.is_absolute() && legacy.source.parent().is_some(),
        "Legacy source must be an absolute non-root directory"
    );
    super::relative(legacy.source.strip_prefix("/")?)?;
    ensure!(
        legacy.source.canonicalize()?.as_os_str() == legacy.source.as_os_str()
            && legacy.source.is_dir(),
        "Legacy source must be a canonical directory"
    );
    super::settings::validate(&legacy.settings)?;
    let links = declared_links(home, legacy, &legacy.links, false)?;
    let settings_links = declared_links(home, legacy, &legacy.settings_links, true)?;
    for setting in &legacy.settings {
        ensure!(
            !home.join(&setting.destination).starts_with(&legacy.source),
            "Legacy source contains an installation destination"
        );
    }
    Ok(Previous {
        links,
        settings: legacy.settings.clone(),
        settings_links,
    })
}

fn declared_links(
    home: &Path,
    legacy: &LegacyInstallation,
    links: &[LegacyLink],
    settings: bool,
) -> Result<Targets> {
    let mut targets = Targets::new();
    for link in links {
        super::relative(&link.destination)?;
        ensure!(
            link.target.is_absolute() && link.target.parent().is_some(),
            "Legacy link target must be absolute and non-root"
        );
        super::relative(link.target.strip_prefix("/")?)?;
        ensure!(
            !home.join(&link.destination).starts_with(&legacy.source),
            "Legacy source contains an installation destination"
        );
        let allowed = if settings {
            matches!(
                link.destination.to_str(),
                Some(".claude/settings.json" | ".pi/agent/settings.json")
            ) && link.target.starts_with(&legacy.source)
        } else {
            super::destination_allowed(&link.destination)
        };
        ensure!(
            allowed,
            "Unsupported legacy link destination or settings source"
        );
        ensure!(
            targets
                .insert(link.destination.clone(), link.target.clone())
                .is_none(),
            "Duplicate legacy link destination"
        );
    }
    Ok(targets)
}
