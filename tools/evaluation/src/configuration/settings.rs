//! Ownership applies to scalar fields or individual array entries, never a whole settings file.
use super::document::Document;
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Value,
    ArrayEntry,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Setting {
    pub destination: PathBuf,
    pub path: Vec<String>,
    pub mode: Mode,
    pub value: Value,
}

pub(super) fn validate(settings: &[Setting]) -> Result<()> {
    for (index, setting) in settings.iter().enumerate() {
        ensure!(
            setting.path.iter().all(|key| crate::paths::is_text(key)),
            "Invalid settings key"
        );
        ensure!(
            allowed(setting),
            "Unsupported managed settings field or value"
        );
        for earlier in &settings[..index] {
            if earlier.destination != setting.destination {
                continue;
            }
            let same_array = earlier.path == setting.path
                && earlier.mode == Mode::ArrayEntry
                && setting.mode == Mode::ArrayEntry;
            let overlap =
                earlier.path.starts_with(&setting.path) || setting.path.starts_with(&earlier.path);
            ensure!(
                !overlap
                    || (same_array
                        && Document::from_value(&earlier.value)?
                            != Document::from_value(&setting.value)?),
                "Duplicate or overlapping settings ownership"
            );
        }
    }
    Ok(())
}

fn allowed(setting: &Setting) -> bool {
    let path: Vec<_> = setting.path.iter().map(String::as_str).collect();
    match setting.destination.to_str() {
        Some(".claude/settings.json") => claude_allowed(&path, &setting.mode, &setting.value),
        Some(".pi/agent/settings.json") => pi_allowed(&path, &setting.mode, &setting.value),
        _ => false,
    }
}

fn claude_allowed(path: &[&str], mode: &Mode, value: &Value) -> bool {
    match (mode, path) {
        (Mode::Value, ["theme" | "tui"]) => value.is_string(),
        (
            Mode::Value,
            [
                "disableClaudeAiConnectors"
                | "disableBundledSkills"
                | "disableRemoteControl"
                | "disableWorkflows"
                | "disableArtifact",
            ],
        ) => value.is_boolean(),
        (Mode::Value, ["enabledPlugins", _]) => value.is_boolean(),
        (Mode::Value, ["env", "DISABLE_AUTOUPDATER" | "CLAUDE_CODE_PLUGIN_DIRS"]) => {
            value.is_string()
        }
        (Mode::Value, ["statusLine", "type" | "command"]) => value.is_string(),
        (Mode::Value, ["statusLine", "padding"]) => value.is_u64(),
        (
            Mode::ArrayEntry,
            [
                "permissions",
                "allow" | "deny" | "ask" | "additionalDirectories",
            ],
        ) => value.is_string(),
        (Mode::ArrayEntry, ["hooks", _]) => value.is_object(),
        _ => false,
    }
}

fn pi_allowed(path: &[&str], mode: &Mode, value: &Value) -> bool {
    match (mode, path) {
        (Mode::Value, ["theme" | "tuiMode"]) => value.is_string(),
        (Mode::Value, ["quietStartup"]) => value.is_boolean(),
        (Mode::ArrayEntry, ["extensions" | "skills" | "prompts" | "themes"]) => value.is_string(),
        _ => false,
    }
}

#[derive(Default)]
struct Group<'a> {
    previous: Vec<&'a Setting>,
    desired: Vec<&'a Setting>,
}

pub(super) fn merge(
    current: &Document,
    previous: &[&Setting],
    desired: &[&Setting],
) -> Result<Document> {
    let mut groups: BTreeMap<&[String], Group<'_>> = BTreeMap::new();
    for setting in previous {
        groups
            .entry(&setting.path)
            .or_default()
            .previous
            .push(setting);
    }
    for setting in desired {
        groups
            .entry(&setting.path)
            .or_default()
            .desired
            .push(setting);
    }
    let mut merged = current.clone();
    for (path, group) in groups {
        let mode = group
            .previous
            .first()
            .or(group.desired.first())
            .unwrap()
            .mode
            .clone();
        ensure!(
            group
                .previous
                .iter()
                .chain(&group.desired)
                .all(|setting| setting.mode == mode),
            "Settings ownership mode changed"
        );
        let before = current.at(path)?;
        let after = match mode {
            Mode::Value => scalar(before, &group)?,
            Mode::ArrayEntry => array(before, &group)?,
        };
        merged.set(path, after)?;
    }
    Ok(merged)
}

fn values(settings: &[&Setting]) -> Result<Vec<Document>> {
    settings
        .iter()
        .map(|setting| Document::from_value(&setting.value))
        .collect()
}

fn scalar(current: Option<&Document>, group: &Group<'_>) -> Result<Option<Document>> {
    let previous = values(&group.previous)?;
    let desired = values(&group.desired)?;
    ensure!(
        current.is_none() || current == previous.first(),
        "Unowned or modified settings field"
    );
    Ok(desired.into_iter().next())
}

fn array(current: Option<&Document>, group: &Group<'_>) -> Result<Option<Document>> {
    let entries = match current {
        Some(Document::Array(entries)) => entries.clone(),
        None => Vec::new(),
        _ => anyhow::bail!("Managed settings field must be an array"),
    };
    let previous = values(&group.previous)?;
    let desired = values(&group.desired)?;
    if current.is_some() {
        ensure!(
            previous
                .iter()
                .all(|value| entries.iter().filter(|entry| *entry == value).count() == 1),
            "Missing, modified, or duplicated owned settings entry"
        );
    }
    ensure!(
        desired
            .iter()
            .all(|value| previous.contains(value) || !entries.contains(value)),
        "Unowned settings entry conflicts with installation"
    );
    let mut retained: Vec<_> = entries
        .into_iter()
        .filter(|entry| !previous.contains(entry) || desired.contains(entry))
        .collect();
    for value in desired {
        if !retained.contains(&value) {
            retained.push(value);
        }
    }
    if current.is_none() && retained.is_empty() {
        return Ok(None);
    }
    Ok(Some(Document::Array(retained)))
}
