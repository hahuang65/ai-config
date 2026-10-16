//! Browser publication is separate from repair decisions and bound to a signed exact preview.
use crate::{
    change_post, change_provider as provider, change_selection,
    change_store::{self, Store},
    change_types::Report,
    paths::Paths,
};
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeSet,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

struct Selected {
    store: Store,
    directory: PathBuf,
    report: Report,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Owner {
    version: u32,
    evaluation: PathBuf,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Preview {
    report_digest: String,
    actor: u64,
    login: String,
    marker: String,
    payload: Value,
    expires: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SourceContext {
    report_digest: String,
    roots: Vec<PathBuf>,
}

pub(crate) fn save_sources(store: &Store, directory: &Path, report: &Report) -> Result<()> {
    let repository = Path::new(&report.scope.repository);
    let excluded = if repository.is_absolute() {
        vec![repository]
    } else {
        vec![]
    };
    let context = SourceContext {
        report_digest: change_post::digest(report)?,
        roots: crate::change_command::source_roots(&excluded)?,
    };
    store.save_object(directory, "source-context.json", &context)
}

/// Reuse the signed report's command exclusions for independent artifact clients and server restarts.
pub fn source_context(html: &Path, digest: &str, revision: &str) -> Result<Vec<PathBuf>> {
    let selected = selected(html, digest, revision)?;
    let roots = if selected
        .directory
        .join("source-context.json")
        .try_exists()?
    {
        let saved: SourceContext = selected
            .store
            .load_object(&selected.directory, "source-context.json")?;
        ensure!(
            saved.report_digest == change_post::digest(&selected.report)?,
            "Source context does not match report"
        );
        saved.roots
    } else {
        let repository = Path::new(&selected.report.scope.repository);
        if repository.is_absolute() {
            vec![repository.to_owned()]
        } else {
            vec![]
        }
    };
    ensure!(
        roots.len() <= 128 && roots.iter().all(|path| path.is_absolute()),
        "Invalid retained source exclusions"
    );
    Ok(roots)
}

fn selected(html: &Path, digest: &str, revision: &str) -> Result<Selected> {
    ensure!(
        html.file_name().is_some_and(|name| name == "report.html"),
        "Select a retained report"
    );
    let root = html
        .parent()
        .and_then(Path::parent)
        .context("Report has no store")?;
    let owner: Owner =
        serde_json::from_slice(&change_store::read(&root.join("owner.json"), 8192)?)?;
    ensure!(owner.version == 1, "Unsupported store owner");
    let store = Store::open(&Paths::new(Some(owner.evaluation))?, Some(root))?;
    let (directory, report) = store.load(html)?;
    let bytes = change_store::read(&directory.join("report.json"), 512 * 1024)?;
    ensure!(
        format!("{:x}", Sha256::digest(bytes)) == digest && report.html_digest == revision,
        "Report changed; obtain a fresh review"
    );
    Ok(Selected {
        store,
        directory,
        report,
    })
}

fn status(selected: &Selected) -> Result<Value> {
    let report = &selected.report;
    let Some(pr) = &report.scope.pull_request else {
        return Ok(json!({"available": false}));
    };
    let mut state = "ready";
    if selected.directory.join("receipt.json").try_exists()? {
        let receipt: change_post::Receipt = selected
            .store
            .load_object(&selected.directory, "receipt.json")?;
        ensure!(
            receipt.report_digest == change_post::digest(report)?,
            "Receipt does not match report"
        );
        state = "posted";
    } else if selected.directory.join("attempt.json").try_exists()? {
        let attempt: change_post::Attempt = selected
            .store
            .load_object(&selected.directory, "attempt.json")?;
        ensure!(
            attempt.report_digest == change_post::digest(report)?,
            "Attempt does not match report"
        );
        state = "uncertain";
    }
    Ok(json!({"available": true, "status": state, "url": pr.url,
        "items": report.findings.iter().map(|finding| json!({"id":finding.id,"title":finding.proposal.title})).collect::<Vec<_>>()}))
}

pub fn information(html: &Path, digest: &str, revision: &str) -> Result<Value> {
    status(&selected(html, digest, revision)?)
}

fn actor(report: &Report) -> Result<(u64, String)> {
    let account = provider::api(Path::new(&report.scope.repository), "user", None)?;
    let id = account["id"]
        .as_u64()
        .filter(|id| *id > 0)
        .context("Cannot establish GitHub account")?;
    let login = account["login"]
        .as_str()
        .context("Cannot establish GitHub account name")?;
    crate::change_types::text(login, 200)?;
    Ok((id, login.into()))
}

fn now() -> Result<u64> {
    Ok(SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs())
}

pub fn prepare(html: &Path, digest: &str, revision: &str, ids: &[String]) -> Result<Value> {
    let selected = selected(html, digest, revision)?;
    let _lock = change_post::lock(&selected.directory)?;
    let state = status(&selected)?;
    ensure!(
        state["available"] == true && state["status"] == "ready",
        "Report is not available for a new publication"
    );
    let unique = selection(&selected.report, ids)?;
    ensure!(
        std::fs::read_dir(&selected.directory)?.take(129).count() < 128,
        "Preview limit reached for this report"
    );
    let token = format!("{:032x}", rand::random::<u128>());
    let preview = preview(&selected, &unique, &token)?;
    selected.store.save_object(
        &selected.directory,
        &format!("preview-{token}.json"),
        &preview,
    )?;
    Ok(
        json!({"token":token,"account":{"id":preview.actor,"login":preview.login},
        "url":state["url"],"base":selected.report.scope.base,"head":selected.report.scope.head,
        "request":preview.payload,"expires":preview.expires}),
    )
}

fn selection(report: &Report, ids: &[String]) -> Result<BTreeSet<String>> {
    let unique: BTreeSet<_> = ids.iter().cloned().collect();
    ensure!(
        !unique.is_empty()
            && unique.len() == ids.len()
            && unique.len() <= 50
            && unique
                .iter()
                .all(|id| report.findings.iter().any(|finding| &finding.id == id)),
        "Select one or more known findings without duplicates"
    );
    Ok(unique)
}

fn preview(selected: &Selected, unique: &BTreeSet<String>, token: &str) -> Result<Preview> {
    provider::check(&selected.report.scope)?;
    let (actor, login) = actor(&selected.report)?;
    let marker = format!(
        "review-change-eval:{}:{token}",
        selected
            .directory
            .file_name()
            .unwrap()
            .to_str()
            .context("Invalid report ID")?
    );
    Ok(Preview {
        report_digest: change_post::digest(&selected.report)?,
        actor,
        login,
        payload: change_selection::payload(&selected.report, unique, &marker),
        marker,
        expires: now()? + 600,
    })
}

pub fn reconcile(html: &Path, digest: &str, revision: &str) -> Result<Value> {
    let selected = selected(html, digest, revision)?;
    let _lock = change_post::lock(&selected.directory)?;
    ensure!(
        change_post::finished(&selected.store, &selected.directory, &selected.report)?,
        "No prior publication attempt to reconcile"
    );
    status(&selected)
}

pub fn confirm(html: &Path, digest: &str, revision: &str, token: &str) -> Result<Value> {
    ensure!(
        token.len() == 32
            && token
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)),
        "Invalid preview token"
    );
    let selected = selected(html, digest, revision)?;
    let _lock = change_post::lock(&selected.directory)?;
    let preview: Preview = selected
        .store
        .load_object(&selected.directory, &format!("preview-{token}.json"))?;
    ensure!(
        preview.report_digest == change_post::digest(&selected.report)?,
        "Preview does not match report"
    );
    verify_attempt(&selected, &preview)?;
    // A persisted attempt is reconciled, never resent, even if its response was lost.
    if change_post::finished(&selected.store, &selected.directory, &selected.report)? {
        return status(&selected);
    }
    ensure!(
        now()? <= preview.expires,
        "Preview expired; preview the selection again"
    );
    provider::check(&selected.report.scope)?;
    let (actor, login) = actor(&selected.report)?;
    ensure!(
        actor == preview.actor && login == preview.login,
        "GitHub account changed; preview again"
    );
    submit(&selected, preview, actor)?;
    status(&selected)
}

fn verify_attempt(selected: &Selected, preview: &Preview) -> Result<()> {
    if selected.directory.join("attempt.json").try_exists()? {
        let attempt: change_post::Attempt = selected
            .store
            .load_object(&selected.directory, "attempt.json")?;
        ensure!(
            attempt.marker == preview.marker
                && attempt.payload == preview.payload
                && attempt.actor == preview.actor
                && attempt.report_digest == preview.report_digest,
            "A different preview already owns this report's publication attempt"
        );
    }
    Ok(())
}

fn submit(selected: &Selected, preview: Preview, actor: u64) -> Result<()> {
    let attempt = change_post::Attempt {
        report_digest: preview.report_digest,
        actor,
        marker: preview.marker,
        payload: preview.payload,
    };
    change_post::submit(
        &selected.store,
        &selected.directory,
        &selected.report,
        &attempt,
    )
}
