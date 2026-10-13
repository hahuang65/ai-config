use crate::cli::{Command, Page};
use crate::error::{Error, Result};
use crate::model::{Entry, Log};
use crate::scope::Selection;
use serde::Serialize;
use serde_json::{Value, json};
use time::{Date, OffsetDateTime, format_description::well_known::Rfc3339};

pub fn run(command: &Command, selection: &Selection, log: &Log) -> Result<Value> {
    match command {
        Command::List { state, page } => {
            let tasks = log
                .tasks
                .values()
                .filter(|task| selection.matches(&task.project) && task.state.matches(*state));
            paginate(tasks.collect(), page)
        }
        Command::History {
            task,
            since,
            until,
            page,
        } => {
            if let Some(id) = task
                && !selection.matches(&log.task(*id)?.project)
            {
                return Err(Error::usage(
                    "task belongs to another project; select its project explicitly",
                ));
            }
            let entries = log
                .entries
                .iter()
                .filter(|entry| {
                    selection.matches(&entry.project)
                        && task.is_none_or(|id| entry.task == Some(id))
                        && in_period(entry, *since, *until)
                })
                .map(|entry| interpreted(log, entry))
                .collect::<Result<Vec<_>>>()?;
            paginate(entries, page)
        }
        Command::Projects { page } => paginate(log.projects(), page),
        _ => Err(Error::usage("expected a query command; see --help")),
    }
}

fn in_period(entry: &Entry, since: Option<Date>, until: Option<Date>) -> bool {
    let date = OffsetDateTime::parse(&entry.at, &Rfc3339)
        .expect("validated entry timestamp")
        .to_offset(time::UtcOffset::UTC)
        .date();
    since.is_none_or(|since| date >= since) && until.is_none_or(|until| date <= until)
}

fn interpreted(log: &Log, entry: &Entry) -> Result<Value> {
    let mut value = serde_json::to_value(entry).map_err(|_| Error::corrupt())?;
    let effective = log.effective(entry);
    value["effective_text"] = json!(effective.text);
    value["effective_commit"] = json!(effective.commit);
    Ok(value)
}

fn paginate<T: Serialize>(mut items: Vec<T>, page: &Page) -> Result<Value> {
    let total = items.len();
    if !page.all {
        items.truncate(page.limit);
    }
    let omitted = total - items.len();
    Ok(json!({ "items": items, "total": total, "omitted": omitted }))
}
