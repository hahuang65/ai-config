use crate::{
    change_provider as provider, change_reconcile, change_selection,
    change_store::{self, Store},
    change_types::Report,
};
use anyhow::{Context, Result, bail, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs::OpenOptions, io::IsTerminal, os::unix::fs::OpenOptionsExt, path::Path};

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Attempt {
    pub report_digest: String,
    pub actor: u64,
    pub marker: String,
    pub payload: Value,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Receipt {
    pub report_digest: String,
    pub review_id: u64,
    pub url: String,
}

pub fn digest(report: &Report) -> Result<String> {
    Ok(format!("{:x}", Sha256::digest(serde_json::to_vec(report)?)))
}

pub fn terminal_required() -> Result<()> {
    ensure!(
        std::io::stdin().is_terminal() && std::io::stdout().is_terminal(),
        "Posting requires a human terminal; open the retained report and run post yourself"
    );
    Ok(())
}

pub fn post(store: &Store, selected: &Path) -> Result<()> {
    terminal_required()?;
    let (directory, report) = store.load(selected)?;
    ensure!(
        report.scope.pull_request.is_some(),
        "Local reviews are presentation-only and cannot post"
    );
    let _lock = lock(&directory)?;
    if finished(store, &directory, &report)? {
        return Ok(());
    }
    confirm_and_submit(store, selected, &directory, &report)
}

fn lock(directory: &Path) -> Result<std::fs::File> {
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(directory.join("post.lock"))?;
    fs2::FileExt::try_lock_exclusive(&lock)
        .context("Another posting session owns this report; no comments sent")?;
    Ok(lock)
}

fn finished(store: &Store, directory: &Path, report: &Report) -> Result<bool> {
    if directory.join("receipt.json").try_exists()? {
        let receipt: Receipt = store.load_object(directory, "receipt.json")?;
        ensure!(
            receipt.report_digest == digest(report)?,
            "Receipt does not match this report"
        );
        println!("Already posted: {}", receipt.url);
        return Ok(true);
    }
    if directory.join("attempt.json").try_exists()? {
        reconcile(store, directory, report)?;
        return Ok(true);
    }
    Ok(false)
}

fn confirm_and_submit(
    store: &Store,
    selected: &Path,
    directory: &Path,
    report: &Report,
) -> Result<()> {
    let nonce = format!("{:032x}", rand::random::<u128>());
    // Persisted marker namespace: a CLI rename must not break post reconciliation.
    let marker = format!(
        "review-change-eval:{}:{nonce}",
        directory
            .file_name()
            .unwrap()
            .to_str()
            .context("Invalid report identifier")?
    );
    let Some(payload) = change_selection::select(report, &nonce, &marker)? else {
        return Ok(());
    };
    let (_, current) = store.load(selected)?;
    ensure!(
        digest(&current)? == digest(report)?,
        "Report changed after preview; start again"
    );
    provider::check(&report.scope)?;
    let actor = provider::api(Path::new(&report.scope.repository), "user", None)?["id"]
        .as_u64()
        .filter(|n| *n > 0)
        .context("Cannot establish the GitHub account identity")?;
    let attempt = Attempt {
        report_digest: digest(report)?,
        actor,
        marker,
        payload,
    };
    submit(store, directory, report, &attempt)
}

fn submit(store: &Store, directory: &Path, report: &Report, attempt: &Attempt) -> Result<()> {
    // Save the request before starting the mutation. A lost response must never
    // turn the next invocation into a blind retry.
    provider::check(&report.scope)?;
    let request = directory.join("request.json");
    change_store::write(&request, &serde_json::to_vec(&attempt.payload)?)?;
    store.save_object(directory, "attempt.json", attempt)?;
    let pr = report.scope.pull_request.as_ref().unwrap();
    if provider::api(
        Path::new(&report.scope.repository),
        &format!("{}/reviews", provider::endpoint(pr)),
        Some(&request),
    )
    .is_err()
    {
        bail!(
            "Posting outcome is uncertain. Run post on this same report to reconcile; do not resubmit manually"
        );
    }
    reconcile(store, directory, report)
}

fn reconcile(store: &Store, directory: &Path, report: &Report) -> Result<()> {
    let attempt: Attempt = store.load_object(directory, "attempt.json")?;
    ensure!(
        attempt.report_digest == digest(report)?,
        "Attempt does not match this report; no new submission allowed"
    );
    let receipt = change_reconcile::confirm(report, &attempt)?;
    store.save_object(directory, "receipt.json", &receipt)?;
    println!("Confirmed comment-only review: {}", receipt.url);
    Ok(())
}
