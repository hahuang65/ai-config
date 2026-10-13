//! Claims come from captured defaults, never from mutable source or installed settings.
use super::{Mode, Setting, document, settings};
use anyhow::{Context, Result};
use serde_json::Value;

const TEMPLATES: &[(&str, &str, &[u8])] = &[
    (
        "claude",
        ".claude/settings.json",
        include_bytes!("legacy_defaults/claude.json"),
    ),
    (
        "pi",
        ".pi/agent/settings.json",
        include_bytes!("legacy_defaults/pi.json"),
    ),
];

pub(super) fn claims() -> Result<Vec<Setting>> {
    let mut claims = Vec::new();
    for &(harness, destination, bytes) in TEMPLATES {
        document::object(bytes)?;
        let value: Value =
            serde_json::from_slice(bytes).context("Invalid captured legacy defaults")?;
        for (key, value) in value
            .as_object()
            .context("Legacy settings template must be an object")?
        {
            if preference(harness, key) {
                continue;
            }
            match (harness, key.as_str()) {
                ("claude", "env" | "enabledPlugins" | "statusLine") => {
                    object_fields(&mut claims, destination, key, value, false)?
                }
                ("claude", "permissions" | "hooks") => {
                    object_fields(&mut claims, destination, key, value, true)?
                }
                _ => claims.push(setting(destination, &[key], Mode::Value, value.clone())),
            }
        }
    }
    settings::validate(&claims)?;
    Ok(claims)
}

fn preference(harness: &str, key: &str) -> bool {
    match harness {
        "claude" => key == "model",
        "pi" => matches!(
            key,
            "defaultProvider"
                | "defaultModel"
                | "defaultThinkingLevel"
                | "enabledModels"
                | "modelThinkingLevels"
                | "thinkingBudgets"
        ),
        _ => false,
    }
}

fn object_fields(
    claims: &mut Vec<Setting>,
    destination: &str,
    key: &str,
    value: &Value,
    array: bool,
) -> Result<()> {
    for (child, value) in value
        .as_object()
        .context("Legacy settings group must be an object")?
    {
        if array {
            validate_array_path(destination, key, child)?;
            for entry in value
                .as_array()
                .context("Legacy settings group must contain arrays")?
            {
                claims.push(setting(
                    destination,
                    &[key, child],
                    Mode::ArrayEntry,
                    entry.clone(),
                ));
            }
        } else {
            claims.push(setting(
                destination,
                &[key, child],
                Mode::Value,
                value.clone(),
            ));
        }
    }
    Ok(())
}

fn validate_array_path(destination: &str, key: &str, child: &str) -> Result<()> {
    // Validate the selector even when the template has no entries to claim.
    let representative = if key == "hooks" {
        serde_json::json!({})
    } else {
        serde_json::json!("")
    };
    settings::validate(&[setting(
        destination,
        &[key, child],
        Mode::ArrayEntry,
        representative,
    )])
}

fn setting(destination: &str, path: &[&str], mode: Mode, value: Value) -> Setting {
    Setting {
        destination: destination.into(),
        path: path.iter().map(|key| (*key).to_owned()).collect(),
        mode,
        value,
    }
}
