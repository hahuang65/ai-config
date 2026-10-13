//! Select ordinary Pi model preferences for an ephemeral restricted reviewer profile.
use crate::paths::is_text;
use anyhow::{Context, Result, ensure};
use serde_json::{Map, Value, json};
use std::fs;
use std::path::Path;

pub const LEVELS: [&str; 7] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

fn text(value: &Value) -> bool {
    value.as_str().is_some_and(is_text)
}

fn level(value: &Value) -> bool {
    value.as_str().is_some_and(|value| LEVELS.contains(&value))
}

pub fn select(settings: &Value) -> Result<Map<String, Value>> {
    let settings = settings.as_object().context("settings must be an object")?;
    let mut selected = Map::new();
    for key in [
        "defaultProvider",
        "defaultModel",
        "defaultThinkingLevel",
        "enabledModels",
        "modelThinkingLevels",
    ] {
        let Some(value) = settings.get(key) else {
            continue;
        };
        let valid = match key {
            "defaultProvider" | "defaultModel" => text(value),
            "defaultThinkingLevel" => level(value),
            "enabledModels" => value
                .as_array()
                .is_some_and(|models| models.iter().all(text)),
            "modelThinkingLevels" => value.as_object().is_some_and(|levels| {
                levels
                    .iter()
                    .all(|(key, value)| is_text(key) && level(value))
            }),
            _ => unreachable!(),
        };
        ensure!(valid, "Invalid settings field: {key}");
        selected.insert(key.into(), value.clone());
    }
    Ok(selected)
}

pub fn fixed(mut settings: Map<String, Value>) -> Value {
    settings.insert("defaultProjectTrust".into(), json!("never"));
    for key in ["packages", "extensions", "skills", "prompts", "themes"] {
        settings.insert(key.into(), json!([]));
    }
    Value::Object(settings)
}

pub fn read(path: &Path) -> Result<Value> {
    ensure!(
        fs::symlink_metadata(path).is_ok_and(|meta| meta.is_file()),
        "Cannot read valid settings: {}; correct the file and retry",
        path.display()
    );
    serde_json::from_slice(&fs::read(path)?).with_context(|| {
        format!(
            "Cannot read valid settings: {}; correct the file and retry",
            path.display()
        )
    })
}
