use crate::{
    change_post::{Attempt, Receipt},
    change_provider as provider,
    change_types::Report,
};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

fn comment_details(report: &Report, review_id: u64, comment: &Value) -> Result<Value> {
    if comment.get("original_line").is_some() && comment.get("side").is_some() {
        return Ok(comment.clone());
    }
    // GitHub's per-review list uses legacy diff positions. Fetch this comment's
    // modern representation rather than guessing its immutable line and side.
    let id = comment["id"]
        .as_u64()
        .filter(|id| *id > 0)
        .context("Missing comment identifier")?;
    let pr = report.scope.pull_request.as_ref().unwrap();
    let full = provider::api(
        Path::new(&report.scope.repository),
        &format!("repos/{}/{}/pulls/comments/{id}", pr.owner, pr.repo),
        None,
    )?;
    ensure!(
        full["id"].as_u64() == Some(id)
            && full["pull_request_review_id"].as_u64() == Some(review_id),
        "Comment identity does not match the published review"
    );
    Ok(full)
}

fn comments_match(report: &Report, review_id: u64, expected: &Value) -> Result<bool> {
    let expected = expected.as_array().context("Invalid saved comment set")?;
    ensure!(expected.len() <= 50, "Too many saved publication comments");
    let pr = report.scope.pull_request.as_ref().unwrap();
    let comments = provider::pages(
        Path::new(&report.scope.repository),
        &format!("{}/reviews/{review_id}/comments", provider::endpoint(pr)),
        1000,
    )?;
    if comments.len() != expected.len() {
        return Ok(false);
    }
    let mut actual: Vec<_> = comments.iter().map(|c| {
        let c = comment_details(report, review_id, c)?;
        ensure!(c["original_commit_id"] == report.scope.head, "Comment commit does not match the reviewed commit");
        Ok(json!({"path":c["path"],"line":c["original_line"],"side":c["side"],"body":c["body"]}).to_string())
    }).collect::<Result<_>>()?;
    let mut expected: Vec<_> = expected.iter().map(Value::to_string).collect();
    actual.sort();
    expected.sort();
    Ok(actual == expected)
}

pub fn confirm(report: &Report, attempt: &Attempt) -> Result<Receipt> {
    let pr = report
        .scope
        .pull_request
        .as_ref()
        .context("No pull-request destination")?;
    let repo = Path::new(&report.scope.repository);
    let (actual, _, _, _) = provider::resolve(repo, pr)?;
    ensure!(
        &actual == pr,
        "Pull-request identity changed; posting outcome is uncertain"
    );
    let matches: Vec<_> =
        provider::pages(repo, &format!("{}/reviews", provider::endpoint(pr)), 10000)?
            .into_iter()
            .filter(|review| {
                review["body"]
                    .as_str()
                    .is_some_and(|body| body.contains(&attempt.marker))
            })
            .collect();
    ensure!(
        matches.len() == 1,
        "Posting outcome remains uncertain; no repeat submission is allowed"
    );
    let review = &matches[0];
    ensure!(
        review["user"]["id"].as_u64() == Some(attempt.actor)
            && review["commit_id"] == report.scope.head
            && review["state"] == "COMMENTED"
            && review["body"] == attempt.payload["body"],
        "Review receipt does not match the confirmed request; outcome is uncertain"
    );
    let id = review["id"]
        .as_u64()
        .filter(|id| *id > 0)
        .context("Missing GitHub review identifier")?;
    ensure!(
        comments_match(report, id, &attempt.payload["comments"])?,
        "Published comments do not match the preview; no repeat submission is allowed"
    );
    Ok(Receipt {
        report_digest: attempt.report_digest.clone(),
        review_id: id,
        url: format!("{}#pullrequestreview-{id}", pr.url),
    })
}
