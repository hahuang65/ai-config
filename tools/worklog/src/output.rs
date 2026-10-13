use crate::error::{Error, Result};
use serde_json::Value;
use std::io::{self, Write};

pub fn print(value: &Value, json: bool) -> Result<()> {
    let mut stdout = io::stdout().lock();
    let output = if json {
        serde_json::to_string(value).expect("JSON value serialization")
    } else {
        render(value)
    };
    writeln!(stdout, "{output}").map_err(|_| Error {
        code: 1,
        message: "cannot write output; inspect history before retrying a write command",
    })
}

fn render(value: &Value) -> String {
    let Some(items) = value.get("items").and_then(Value::as_array) else {
        return row(&value["entry"]);
    };
    let mut lines = items.iter().map(row).collect::<Vec<_>>();
    lines.push(format!(
        "{} returned; {} total; {} omitted{}",
        items.len(),
        value["total"],
        value["omitted"],
        if value["omitted"].as_u64().unwrap_or(0) > 0 {
            "; use --all for all results"
        } else {
            ""
        }
    ));
    lines.join("\n")
}

fn row(value: &Value) -> String {
    if value.get("kind").is_some() {
        return entry_row(value);
    }
    if value.get("state").is_some() {
        return format!(
            "#{} {} [{}] {}",
            value["id"],
            word(&value["state"]),
            project_name(value),
            value["title"]
        );
    }
    format!("{} {}", value["name"], value["id"])
}

fn entry_row(value: &Value) -> String {
    let text = value.get("effective_text").unwrap_or(&value["text"]);
    let commit = value.get("effective_commit").unwrap_or(&value["commit"]);
    let commit_text = if commit.is_null() {
        String::new()
    } else {
        format!(" commit={} {}", word(&commit["hash"]), commit["subject"])
    };
    let correction = if value["corrects"].is_null() {
        String::new()
    } else {
        format!(" corrects=#{}", value["corrects"])
    };
    let original = if value
        .get("effective_text")
        .is_some_and(|effective| *effective != value["text"])
        || value
            .get("effective_commit")
            .is_some_and(|effective| *effective != value["commit"])
    {
        format!(
            " original_text={} original_commit={}",
            value["text"], value["commit"]
        )
    } else {
        String::new()
    };
    format!(
        "#{} {} {} [{}] task={} {}{}{}{}",
        value["id"],
        word(&value["at"]),
        word(&value["kind"]),
        project_name(value),
        value["task"],
        text,
        commit_text,
        correction,
        original
    )
}

fn project_name(value: &Value) -> String {
    if value["project"].is_null() {
        "unassigned".into()
    } else {
        value["project"]["name"].to_string()
    }
}

fn word(value: &Value) -> &str {
    value.as_str().unwrap_or("?")
}
