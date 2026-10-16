//! Inspect the real shell installer's output in a disposable home, never a second installer.
use anyhow::{Result, ensure};
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
pub struct Manifest {
    pub source: PathBuf,
    pub links: Vec<Link>,
    pub settings: Vec<Setting>,
}

#[derive(Deserialize)]
pub struct Link {
    pub destination: PathBuf,
    pub target: PathBuf,
}

#[derive(Deserialize)]
pub struct Setting {
    pub destination: PathBuf,
    pub path: Vec<String>,
    pub mode: Mode,
    pub value: serde_json::Value,
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Value,
    ArrayEntry,
}

pub fn prepared_manifest(source: &Path) -> Result<Manifest> {
    let home = tempfile::tempdir()?;
    let output = super::shell_install::command(source, &home.path().canonicalize()?).output()?;
    ensure!(
        output.status.success(),
        "Shell installer refused package: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    Ok(serde_json::from_slice(&fs::read(
        home.path().join(".local/state/ai-config/installation.json"),
    )?)?)
}
