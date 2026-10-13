//! Versioned installer ownership, independent of harness resource discovery.
//! Default legacy inventories are explicit; native manifests and activation remain separate work.
mod adoption;
pub use adoption::{LegacyInstallation, LegacyLink, adopt_configuration};
mod adoption_preflight;
pub use adoption_preflight::inspect as preflight_adoption;
mod document;
mod evaluation_inventory;
pub use evaluation_inventory::evaluation_legacy_inventory;
mod legacy_inventory;
mod legacy_layout;
mod legacy_settings;
pub use legacy_inventory::{
    LegacyArtifact, LegacyArtifactLocation, LegacyBoundary, LegacyInventory,
    shared_legacy_inventory,
};
mod numbers;
mod package;
pub use package::prepared_manifest;
mod settings;
mod settings_files;
mod transaction;
use anyhow::{Context, Result, ensure};
use fs2::FileExt;
use serde::{Deserialize, Serialize};
pub use settings::{Mode, Setting};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, symlink};
use std::path::{Component, Path, PathBuf};

const STATE_DIRECTORY: &str = ".local/state/ai-config";
const RECORD: &str = "installation.json";
const LINKS_VERSION: u8 = 1;
const SETTINGS_VERSION: u8 = 2;
type Targets = BTreeMap<PathBuf, PathBuf>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Link {
    pub destination: PathBuf,
    pub target: PathBuf,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub version: u8,
    pub source: PathBuf,
    pub links: Vec<Link>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub settings: Vec<Setting>,
}

struct Change {
    destination: PathBuf,
    before: Option<PathBuf>,
    after: Option<PathBuf>,
}

/// Switch explicitly declared owned links and settings, leaving other resources alone.
/// The caller supplies one manifest covering both harnesses.
/// An unrecorded collision is never adopted.
pub fn switch_configuration(home: &Path, manifest: &Manifest) -> Result<()> {
    switch(home, manifest, None)
}

fn switch(home: &Path, manifest: &Manifest, legacy: Option<&LegacyInstallation>) -> Result<()> {
    absolute_directory(home)?;
    let desired = targets(manifest)?;
    document::object(&serde_json::to_vec(manifest)?)?;
    check_sources(home, manifest, &desired)?;
    let state = home.join(STATE_DIRECTORY);
    let _lock = lock(&state)?;
    let record = state.join(RECORD);
    let previous = prior_state(home, &record, legacy)?;
    check_previous_destinations(home, &manifest.source, &previous)?;
    let links = plan(home, &previous.links, &desired)?;
    let settings = settings_files::plan_with_links(
        home,
        &previous.settings,
        &manifest.settings,
        &previous.settings_links,
    )?;
    let changes: Vec<_> = links
        .into_iter()
        .map(transaction::Change::Link)
        .chain(settings.into_iter().map(transaction::Change::Settings))
        .collect();
    transaction::apply(&changes, &record, manifest)
}

fn prior_state(
    home: &Path,
    record: &Path,
    legacy: Option<&LegacyInstallation>,
) -> Result<adoption::Previous> {
    if let Some(legacy) = legacy {
        ensure!(
            !crate::paths::present(record)?,
            "Legacy adoption requires an absent ownership record; use ordinary switching for a recorded installation"
        );
        return adoption::previous(home, legacy);
    }
    let Some(previous) = previous_manifest(record)? else {
        return Ok(adoption::Previous::default());
    };
    Ok(adoption::Previous {
        links: targets(&previous)?,
        settings: previous.settings,
        settings_links: Targets::new(),
    })
}

fn check_previous_destinations(
    home: &Path,
    source: &Path,
    previous: &adoption::Previous,
) -> Result<()> {
    for destination in previous
        .links
        .keys()
        .chain(previous.settings_links.keys())
        .chain(previous.settings.iter().map(|setting| &setting.destination))
    {
        ensure!(
            !home.join(destination).starts_with(source),
            "Selected source contains a previous installation destination"
        );
    }
    Ok(())
}

fn relative(path: &Path) -> Result<()> {
    ensure!(
        path.to_str().is_some_and(crate::paths::is_text),
        "Invalid resource path"
    );
    ensure!(
        path.components()
            .all(|part| matches!(part, Component::Normal(_))),
        "Resource paths must be relative without parent traversal: {}",
        path.display()
    );
    Ok(())
}

fn absolute_directory(path: &Path) -> Result<()> {
    ensure!(
        path.is_absolute() && path.parent().is_some(),
        "Expected an absolute non-root directory"
    );
    relative(path.strip_prefix("/")?)?;
    real_ancestors(path)
}

fn real_ancestors(directory: &Path) -> Result<()> {
    for ancestor in directory.ancestors().collect::<Vec<_>>().into_iter().rev() {
        if crate::paths::present(ancestor)? {
            ensure!(
                fs::symlink_metadata(ancestor)?.is_dir(),
                "Refusing redirected or non-directory parent: {}",
                ancestor.display()
            );
        }
    }
    Ok(())
}

fn destination_allowed(path: &Path) -> bool {
    let exact = [
        ".claude/CLAUDE.md",
        ".claude/AGENTS.md",
        ".claude/statusline.sh",
        ".claude/statusline.ts",
        ".claude/hooks.json",
        ".claude/plugins/ai-worktree",
        ".claude/plugins/ai-local-lsp",
        ".pi/agent/AGENTS.md",
        ".pi/agent/SYSTEM.md",
        ".pi/agent/APPEND_SYSTEM.md",
    ];
    let directories = [
        ".claude/skills",
        ".claude/commands",
        ".claude/agents",
        ".claude/hooks",
        ".claude/themes",
        ".pi/agent/skills",
        ".pi/agent/prompts",
        ".pi/agent/agents",
        ".pi/agent/extensions",
        ".pi/agent/themes",
    ];
    exact.iter().any(|value| path == Path::new(value))
        || directories
            .iter()
            .any(|value| path != Path::new(value) && path.starts_with(value))
        || (path.starts_with(".local/bin") && path.components().count() == 3)
}

fn targets(manifest: &Manifest) -> Result<Targets> {
    ensure!(
        manifest.version == SETTINGS_VERSION
            || (manifest.version == LINKS_VERSION && manifest.settings.is_empty()),
        "Unsupported installation record version"
    );
    settings::validate(&manifest.settings)?;
    ensure!(
        manifest.source.is_absolute() && manifest.source.parent().is_some(),
        "Configuration source must be an absolute non-root path"
    );
    relative(manifest.source.strip_prefix("/")?)?;
    let mut targets = Targets::new();
    for link in &manifest.links {
        relative(&link.destination)?;
        relative(&link.target)?;
        ensure!(
            destination_allowed(&link.destination),
            "Not an installer link destination: {}",
            link.destination.display()
        );
        ensure!(
            targets
                .insert(link.destination.clone(), manifest.source.join(&link.target))
                .is_none(),
            "Duplicate installation destination: {}",
            link.destination.display()
        );
    }
    Ok(targets)
}

fn check_sources(home: &Path, manifest: &Manifest, targets: &Targets) -> Result<()> {
    ensure!(
        manifest.source.canonicalize()?.as_os_str() == manifest.source.as_os_str()
            && manifest.source.is_dir(),
        "Configuration source must be a canonical directory"
    );
    for destination in targets
        .keys()
        .chain(manifest.settings.iter().map(|setting| &setting.destination))
    {
        ensure!(
            !home.join(destination).starts_with(&manifest.source),
            "Configuration source contains an installation destination"
        );
    }
    for target in targets.values() {
        ensure!(
            target.canonicalize()?.starts_with(&manifest.source),
            "Resource escapes the configuration source: {}",
            target.display()
        );
        let metadata = fs::metadata(target)?;
        ensure!(
            metadata.is_file() || metadata.is_dir(),
            "Unsupported resource: {}",
            target.display()
        );
    }
    Ok(())
}

fn lock(state: &Path) -> Result<File> {
    real_ancestors(state)?;
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(state)?;
    let file = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(state.join("install.lock"))?;
    ensure!(
        file.metadata()?.is_file(),
        "Installation lock must be a regular file"
    );
    file.try_lock_exclusive()
        .context("Another configuration installer is running; retry when it finishes")?;
    Ok(file)
}

fn previous_manifest(record: &Path) -> Result<Option<Manifest>> {
    if !crate::paths::present(record)? {
        return Ok(None);
    }
    ensure!(
        fs::symlink_metadata(record)?.is_file(),
        "Installation record must be a regular file"
    );
    let bytes = fs::read(record)?;
    document::object(&bytes).context("Invalid installation ownership record")?;
    let manifest: Manifest = serde_json::from_slice(&bytes).map_err(|_| {
        anyhow::anyhow!("Invalid installation ownership record; no managed resources changed")
    })?;
    Ok(Some(manifest))
}

fn current_link(path: &Path) -> Result<Option<PathBuf>> {
    if !crate::paths::present(path)? {
        return Ok(None);
    }
    ensure!(
        fs::symlink_metadata(path)?.is_symlink(),
        "Refusing to replace an unrelated file or directory: {}",
        path.display()
    );
    Ok(Some(fs::read_link(path)?))
}

fn exact_target(left: Option<&Path>, right: Option<&Path>) -> bool {
    left.map(Path::as_os_str) == right.map(Path::as_os_str)
}

fn plan(home: &Path, previous: &Targets, desired: &Targets) -> Result<Vec<Change>> {
    let destinations: BTreeSet<_> = previous.keys().chain(desired.keys()).collect();
    let mut changes = Vec::new();
    for destination in &destinations {
        ensure!(
            !destination
                .ancestors()
                .skip(1)
                .any(|parent| destinations.contains(&parent.to_path_buf())),
            "Overlapping installation destinations: {}",
            destination.display()
        );
        let path = home.join(destination);
        real_ancestors(path.parent().context("Missing destination parent")?)?;
        let before = current_link(&path)?;
        ensure!(
            before.is_none()
                || exact_target(
                    before.as_deref(),
                    previous.get(*destination).map(PathBuf::as_path)
                ),
            "Refusing an unowned or modified link: {}",
            path.display()
        );
        let after = desired.get(*destination).cloned();
        ensure!(
            !after
                .as_ref()
                .is_some_and(|target| target.starts_with(&path)),
            "Resource cannot link to itself or its descendants: {}",
            path.display()
        );
        if !exact_target(before.as_deref(), after.as_deref()) {
            changes.push(Change {
                destination: path,
                before,
                after,
            });
        }
    }
    Ok(changes)
}

fn replace_link(destination: &Path, expected: Option<&Path>, target: Option<&Path>) -> Result<()> {
    let parent = destination.parent().context("Missing destination parent")?;
    real_ancestors(parent)?;
    ensure!(
        exact_target(current_link(destination)?.as_deref(), expected),
        "Destination changed during installation: {}",
        destination.display()
    );
    if let Some(target) = target {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(0o700)
            .create(parent)?;
        let staging = tempfile::Builder::new()
            .prefix(".ai-config-")
            .tempdir_in(parent)?;
        let link = staging.path().join("link");
        symlink(target, &link)?;
        fs::rename(link, destination)?;
    } else if expected.is_some() {
        fs::remove_file(destination)?;
    }
    Ok(())
}

fn save(record: &Path, manifest: &Manifest) -> Result<()> {
    let mut staged =
        tempfile::NamedTempFile::new_in(record.parent().context("Missing record parent")?)?;
    serde_json::to_writer_pretty(&mut staged, manifest)?;
    writeln!(staged)?;
    staged.as_file().sync_all()?;
    staged.persist(record)?;
    Ok(())
}
