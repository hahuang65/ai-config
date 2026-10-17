//! Editable browser comments retain immutable, verified finding locations.
use crate::change_types::{Report, text};
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[derive(Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Account {
    pub id: u64,
    pub login: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Comment {
    pub id: String,
    pub body: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Selection {
    pub comments: Vec<Comment>,
    pub account: Account,
    pub base: String,
    pub head: String,
}

pub fn payload(report: &Report, selection: &Selection, marker: &str) -> Result<Value> {
    ensure!(
        !selection.comments.is_empty() && selection.comments.len() <= 50,
        "Select one or more findings, up to 50"
    );
    let mut seen = BTreeSet::new();
    let mut comments = Vec::new();
    for comment in &selection.comments {
        ensure!(seen.insert(&comment.id), "Duplicate publication finding");
        let finding = report
            .findings
            .iter()
            .find(|finding| finding.id == comment.id)
            .ok_or_else(|| anyhow::anyhow!("Unknown publication finding"))?;
        let p = &finding.proposal;
        ensure!(
            finding.inline && p.line.is_some_and(|line| line > 0),
            "Finding has no verified inline location; obtain a fresh review"
        );
        text(&comment.body, 8000)?;
        // Do not trim, escape Markdown, add identifiers, or substitute a review-body comment.
        comments.push(json!({"path":p.path,"line":p.line,"side":p.side,"body":comment.body}));
    }
    Ok(json!({"commit_id":report.scope.head,"event":"COMMENT",
        "body":format!("<!-- {marker} -->"),"comments":comments}))
}
