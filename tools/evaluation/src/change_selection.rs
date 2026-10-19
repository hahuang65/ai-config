use crate::change_types::Report;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::{
    collections::BTreeSet,
    io::{BufRead, Read, Write},
};

fn markdown(text: &str) -> String {
    text.chars()
        .map(|c| {
            if c.is_ascii_punctuation() && !matches!(c, '.' | ',') {
                format!("\\{c}")
            } else {
                c.to_string()
            }
        })
        .collect()
}

fn comment_body(proposal: &crate::change_types::Proposal) -> String {
    match &proposal.explanation {
        Some(explanation) => explanation
            .sections()
            .into_iter()
            .map(|(heading, text)| format!("**{}:**\n\n{}", markdown(heading), markdown(text)))
            .collect::<Vec<_>>()
            .join("\n\n"),
        None => markdown(&proposal.body),
    }
}

pub fn payload(report: &Report, selected: &BTreeSet<String>, marker: &str) -> Value {
    let mut comments = vec![];
    let mut body = format!(
        "Selected change-review comments: {}.",
        selected.iter().cloned().collect::<Vec<_>>().join(", ")
    );
    for finding in report.findings.iter().filter(|f| selected.contains(&f.id)) {
        let p = &finding.proposal;
        let category = if p.kind.is_defect() {
            String::new()
        } else {
            format!("{}: ", p.kind.label())
        };
        let text = format!(
            "### {} · {}{}\n\n{}",
            finding.id,
            category,
            markdown(&p.title),
            comment_body(p)
        );
        if finding.inline {
            comments.push(json!({"path":p.path,"line":p.line,"side":p.side,"body":text}));
        } else {
            body.push_str(&format!("\n\n{text}\n\nReported location: {} ({:?}, line {}). This location was not verified for an inline comment.", markdown(&p.path), p.side, p.line.map(|n| n.to_string()).unwrap_or_else(|| "unspecified".into())));
        }
    }
    body.push_str(&format!("\n\n<!-- {marker} -->"));
    json!({"commit_id":report.scope.head,"event":"COMMENT","body":body,"comments":comments})
}

fn line() -> Result<Option<String>> {
    let mut input = vec![];
    let count = std::io::stdin()
        .lock()
        .take(4097)
        .read_until(b'\n', &mut input)?;
    ensure!(
        count <= 4096,
        "Terminal input exceeds 4096 bytes; nothing posted"
    );
    if count == 0 {
        return Ok(None);
    }
    Ok(Some(String::from_utf8(input)?.trim().to_owned()))
}

fn show(report: &Report, selected: &BTreeSet<String>) {
    println!("\nSelected findings (all start selected):");
    for finding in &report.findings {
        println!(
            "[{}] {} · {} · {}",
            if selected.contains(&finding.id) {
                "x"
            } else {
                " "
            },
            finding.id,
            finding.proposal.kind.label(),
            serde_json::to_string(&finding.proposal.title).unwrap()
        );
    }
    println!("Commands: exclude F1 F2; include F1; all; none; preview; post; cancel.");
}

fn preview(report: &Report, payload: &Value) {
    println!(
        "\nExact GitHub request\nDestination: {}\n{}",
        report.scope.pull_request.as_ref().unwrap().url,
        serde_json::to_string_pretty(payload).unwrap()
    );
    println!(
        "This submits comments only. It does not approve or request changes on the pull request."
    );
}

fn adjust(selected: &mut BTreeSet<String>, all: &BTreeSet<String>, words: &[&str]) -> bool {
    if words.len() < 2 || !words[1..].iter().all(|id| all.contains(*id)) {
        return false;
    }
    for id in &words[1..] {
        if words[0] == "include" {
            selected.insert((*id).into());
        } else {
            selected.remove(*id);
        }
    }
    true
}

pub fn select(report: &Report, nonce: &str, marker: &str) -> Result<Option<Value>> {
    let all: BTreeSet<_> = report.findings.iter().map(|f| f.id.clone()).collect();
    let mut selected = all.clone();
    if selected.is_empty() {
        println!("No findings. Nothing posted.");
        return Ok(None);
    }
    loop {
        show(report, &selected);
        print!("Selection> ");
        std::io::stdout().flush()?;
        let Some(input) = line()? else {
            println!("Cancelled. Nothing posted.");
            return Ok(None);
        };
        let words: Vec<_> = input.split_whitespace().collect();
        match words.as_slice() {
            ["cancel"] => {
                println!("Cancelled. Nothing posted.");
                return Ok(None);
            }
            ["none"] => selected.clear(),
            ["all"] => selected = all.clone(),
            ["preview"] => preview(report, &payload(report, &selected, marker)),
            ["post"] => return confirm(report, &selected, nonce, marker),
            ["include" | "exclude", ..] if adjust(&mut selected, &all, &words) => {}
            _ => println!("Unknown command or finding identifier; selection was not changed."),
        }
    }
}

fn confirm(
    report: &Report,
    selected: &BTreeSet<String>,
    nonce: &str,
    marker: &str,
) -> Result<Option<Value>> {
    if selected.is_empty() {
        println!("No findings selected. Nothing posted.");
        return Ok(None);
    }
    let payload = payload(report, selected, marker);
    preview(report, &payload);
    let confirmation = format!("POST {nonce}");
    print!("Confirm by typing {confirmation}: ");
    std::io::stdout().flush()?;
    if line()?.as_deref() != Some(&confirmation) {
        println!("Cancelled. Nothing posted.");
        return Ok(None);
    }
    ensure!(
        report.scope.pull_request.is_some(),
        "Local reviews cannot post"
    );
    payload["body"].as_str().context("Invalid posting body")?;
    Ok(Some(payload))
}
