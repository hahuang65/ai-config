//! Separate catalogue-data validation from inspection of real shell installation records.
use anyhow::{Result, bail, ensure};
use serde::Deserialize;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Duration,
};
use wait_timeout::ChildExt;

#[derive(Deserialize)]
pub struct Manifest {
    pub source: PathBuf,
    pub links: Vec<Link>,
    pub settings: Vec<Setting>,
}

#[derive(Debug, Deserialize, PartialEq, Eq)]
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

// Catalogue data only: filesystem refusals and installation effects use prepared_manifest.
pub fn catalogue_manifest(source: &Path) -> Result<Manifest> {
    let output = tempfile::NamedTempFile::new()?;
    let modules = source.join("tools/install");
    let mut child = Command::new("jq")
        .arg("-L").arg(&modules)
        .args(["--slurpfile", "permissions"]).arg(modules.join("permissions.json"))
        .args(["--arg", "source"]).arg(source)
        .args(["-ce", "include \"manifest\"; if .source == \".\" then .source = $source else . end | native_package($permissions[0])"])
        .arg(source.join("manifest.json"))
        .stdin(Stdio::null())
        .stdout(output.reopen()?)
        .stderr(Stdio::null())
        .spawn()?;
    let Some(status) = child.wait_timeout(Duration::from_secs(10))? else {
        child.kill()?;
        child.wait()?;
        bail!("Production catalogue filter timed out");
    };
    ensure!(
        status.success(),
        "Production catalogue filter refused manifest"
    );
    Ok(serde_json::from_reader(output.reopen()?)?)
}

pub fn installed_manifest(home: &Path) -> Result<Manifest> {
    Ok(serde_json::from_slice(&fs::read(
        home.join(".local/state/ai-config/installation.json"),
    )?)?)
}

pub fn prepared_manifest(source: &Path) -> Result<Manifest> {
    let home = tempfile::tempdir()?;
    let output = super::shell_install::command(source, &home.path().canonicalize()?).output()?;
    ensure!(
        output.status.success(),
        "Shell installer refused package: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    installed_manifest(home.path())
}
