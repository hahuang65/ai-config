//! Dispatch and protocol-version-1 rendering.
use crate::{
    Error, Result,
    args::{self, Parse},
    git, lifecycle, process,
    repository::Repository,
    text,
};
use serde_json::Value;
use std::io::Write;

pub fn main() -> Result<i32> {
    let values: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|value| text::from_os(&value))
        .collect();
    if values.first().is_some_and(|value| value == "session") {
        return crate::sessions::main(&values[1..]);
    }
    let args = match args::parse(values) {
        Parse::Run(args) => args,
        Parse::Exit(code) => return Ok(code),
    };
    process::install_interrupt_handler()?;
    let repo = Repository::new(&std::env::current_dir()?)?;
    let result = {
        let _lock = git::repository_lock(&repo.common)?;
        match args.command.as_str() {
            "new" => lifecycle::new(
                &repo,
                args.task.as_deref().expect("required task"),
                args.base.as_deref(),
                args.local,
            ),
            "enter" => lifecycle::enter(&repo, args.task.as_deref().expect("required task")),
            "clean" => lifecycle::clean(&repo, args.task.as_deref(), args.check),
            "list" => lifecycle::list(&repo, args.all),
            _ => unreachable!(),
        }?
    };
    let output = if args.json {
        format!("{}\n", ascii_json(&result)?)
    } else {
        render(&result)
    };
    std::io::stdout().write_all(&text::encode(&output))?;
    Ok(i32::from(
        result["cleanupIncomplete"] == true
            || result["results"].as_array().is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.get("reason").is_some() || item["cleanupIncomplete"] == true)
            }),
    ))
}

fn ascii_json(value: &Value) -> Result<String> {
    Ok(text::ascii_json(&json_with_spaces(value)?))
}

fn json_with_spaces(value: &Value) -> Result<String> {
    match value {
        Value::Array(values) => Ok(format!(
            "[{}]",
            values
                .iter()
                .map(json_with_spaces)
                .collect::<Result<Vec<_>>>()?
                .join(", ")
        )),
        Value::Object(values) => {
            let fields = values
                .iter()
                .map(|(key, value)| {
                    Ok(format!(
                        "{}: {}",
                        json_with_spaces(&Value::String(key.clone()))?,
                        json_with_spaces(value)?
                    ))
                })
                .collect::<Result<Vec<_>>>()?;
            Ok(format!("{{{}}}", fields.join(", ")))
        }
        _ => serde_json::to_string(value).map_err(|error| Error::new(error.to_string())),
    }
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

pub fn render(result: &Value) -> String {
    match text(result, "command") {
        "new" | "enter" => format!("{}\n", text(&result["worktree"], "path")),
        "list" => render_list(result),
        _ if result.get("results").is_some() => render_batch(result),
        _ => render_clean(result),
    }
}

fn render_list(result: &Value) -> String {
    let mut lines = Vec::new();
    for entry in result["worktrees"].as_array().expect("inventory array") {
        let branch = text(entry, "branch");
        let branch = if branch.is_empty() {
            "detached"
        } else {
            branch
        };
        let locked = if entry["locked"] == true {
            " [locked]"
        } else {
            ""
        };
        let unmanaged = if entry["managed"] == false {
            " [unmanaged]"
        } else {
            ""
        };
        lines.push(format!(
            "{}: {branch}{locked}{unmanaged}\n  {}",
            text(entry, "task"),
            text(entry, "path")
        ));
    }
    if result["omitted"].as_u64().unwrap_or(0) > 0 {
        lines.push(format!(
            "{} more worktrees. Use wt list --all.",
            result["omitted"]
        ));
    }
    format!("{}\n", lines.join("\n"))
}

fn render_batch(result: &Value) -> String {
    let results = result["results"].as_array().expect("cleanup array");
    if results.is_empty() {
        return "No managed worktrees to clean.\n".into();
    }
    results
        .iter()
        .map(|item| {
            if item.get("command").is_some() {
                render(item)
            } else {
                format!(
                    "Kept {}: {}\n",
                    text(&item["worktree"], "task"),
                    text(item, "reason")
                )
            }
        })
        .collect()
}

fn render_clean(result: &Value) -> String {
    let task = text(&result["worktree"], "task");
    let proof = text(result, "proof");
    if result["removed"] == true {
        let branch = if result["branchRemoved"] == true {
            "Local branch deleted.".to_string()
        } else {
            format!("Branch retained: {}", text(result, "branchReason"))
        };
        return format!("Removed {task}; {proof}. {branch}\n");
    }
    if result["transition"]["kind"] == "return-main" {
        return format!(
            "Return to {}, then run wt clean {task}. Nothing removed yet.\n",
            text(&result["project"], "root")
        );
    }
    format!("Safe to remove {task}; {proof}. Nothing removed in check mode.\n")
}
