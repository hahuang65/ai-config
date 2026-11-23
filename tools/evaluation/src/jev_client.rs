//! Advisory-only native Pi classifier transport; credentials stay inside Pi.
use crate::{
    change_command,
    paths::Paths,
    reviewer_diagnostics::{Category, Failure},
    reviewer_process,
};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, path::Path, time::Instant};

pub const MODEL: &str = "jev-1.14.0";
pub const MAX_REQUEST: usize = 32768;

#[derive(Serialize)]
pub struct Request {
    pub state: Value,
    pub questions: BTreeMap<String, Value>,
}

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct Judgment {
    pub status: String,
    pub model: String,
    pub probabilities: BTreeMap<String, f64>,
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub elapsed_ms: u64,
}

pub fn question(instructions: String) -> Value {
    json!({"type":"bool", "instructions":instructions,
        "criteria":{"true":"The supplied evidence supports this condition.",
            "false":"The supplied evidence does not support this condition."}})
}

pub fn advisory(paths: &Paths, excluded: &Path, request: &Request) -> Result<Option<Judgment>> {
    match classify(paths, excluded, request) {
        Ok(answer) => Ok(Some(answer)),
        Err(error)
            if matches!(
                error
                    .downcast_ref::<Failure>()
                    .map(|failure| failure.category),
                Some(Category::ProcessInterrupted)
            ) =>
        {
            Err(error)
        }
        Err(_) => Ok(None),
    }
}

pub fn classify(paths: &Paths, excluded: &Path, request: &Request) -> Result<Judgment> {
    let bytes = serde_json::to_vec(request)?;
    ensure!(
        bytes.len() <= MAX_REQUEST,
        "Jev advisory input exceeds its limit"
    );
    let bridge = paths.source.join("harnesses/pi/jev-bridge.mjs");
    ensure!(
        fs::symlink_metadata(&bridge)?.is_file(),
        "Missing native Jev adapter"
    );
    let input = tempfile::NamedTempFile::new()?;
    fs::write(input.path(), bytes)?;
    let mut command = change_command::command("node", &[excluded])?;
    command.arg(bridge).arg(input.path());
    let started = Instant::now();
    let raw = reviewer_process::run(command, 6)?;
    ensure!(raw.len() <= 65536, "Jev advisory output exceeds its limit");
    let mut result: Judgment = serde_json::from_slice(&raw)?;
    ensure!(
        result.status == "ok" && result.model == MODEL,
        "Jev assessment unavailable"
    );
    ensure!(
        result.probabilities.len() == request.questions.len(),
        "Incomplete Jev assessment"
    );
    for key in request.questions.keys() {
        ensure!(
            result
                .probabilities
                .get(key)
                .is_some_and(|value| value.is_finite() && (0.0..=1.0).contains(value)),
            "Invalid Jev probability"
        );
    }
    result.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(result)
}
