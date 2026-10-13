use crate::{
    change_post::{Attempt, Receipt},
    change_provider as provider,
    change_types::Report,
};
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::path::Path;

fn comments_match(report: &Report, review_id: u64, expected: &Value) -> Result<bool> {
    let pr = report.scope.pull_request.as_ref().unwrap();
    let comments = provider::pages(
        Path::new(&report.scope.repository),
        &format!("{}/reviews/{review_id}/comments", provider::endpoint(pr)),
        1000,
    )?;
    let mut actual: Vec<_> = comments.iter().map(|c| {
        ensure!(c["original_commit_id"] == report.scope.head, "Comment commit does not match the reviewed commit");
        Ok(json!({"path":c["path"],"line":c["original_line"],"side":c["side"],"body":c["body"]}).to_string())
    }).collect::<Result<_>>()?;
    let mut expected: Vec<_> = expected
        .as_array()
        .context("Invalid saved comment set")?
        .iter()
        .map(Value::to_string)
        .collect();
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
