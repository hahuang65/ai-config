use crate::cli::{Command, CommitArgs};
use crate::error::{Error, Result};
use crate::model::{Commit, Entry, Kind, Log, Project, SCHEMA, same_project};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub fn build(command: &Command, project: Option<Project>, log: &Log) -> Result<Entry> {
    let id = log.next_id()?;
    let (kind, task, text, commit, corrects) = fields(command, log, id)?;
    if let Some(target) = corrects
        && !same_project(&project, &log.entry(target)?.project)
    {
        return Err(Error::usage(
            "entry belongs to another project; select its project explicitly",
        ));
    }
    let at = OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|_| Error::storage())?;
    Ok(Entry {
        schema: SCHEMA,
        id,
        at,
        project,
        task,
        kind,
        text,
        commit,
        corrects,
    })
}

type Fields = (Kind, Option<u64>, String, Option<Commit>, Option<u64>);

fn fields(command: &Command, log: &Log, id: u64) -> Result<Fields> {
    let fields = match command {
        Command::Note { title } => (Kind::Note, Some(id), title.clone(), None, None),
        Command::Start {
            title: Some(title), ..
        } => (Kind::Start, Some(id), title.clone(), None, None),
        Command::Start {
            task: Some(task), ..
        } => (
            Kind::Start,
            Some(*task),
            log.task(*task)?.title.clone(),
            None,
            None,
        ),
        Command::Progress { summary, task } => (Kind::Progress, *task, summary.clone(), None, None),
        Command::Commit { task, commit } => (
            Kind::Commit,
            *task,
            commit.subject.clone().ok_or_else(Error::corrupt)?,
            metadata(commit),
            None,
        ),
        Command::Complete {
            task,
            summary,
            commit,
        } => (
            Kind::Complete,
            Some(*task),
            summary.clone().unwrap_or_else(|| "Completed".into()),
            metadata(commit),
            None,
        ),
        Command::Abandon { task, summary } => {
            (Kind::Abandon, Some(*task), summary.clone(), None, None)
        }
        Command::Correct {
            entry,
            text,
            commit,
        } => return correction(log, *entry, text, commit),
        _ => return Err(Error::usage("expected a write command; see --help")),
    };
    Ok(fields)
}

fn correction(log: &Log, id: u64, text: &Option<String>, commit: &CommitArgs) -> Result<Fields> {
    let target = log.entry(id)?;
    if target.kind == Kind::Correct {
        return Err(Error::usage(
            "correct the original entry, not a correction entry",
        ));
    }
    let effective = log.effective(target);
    let commit_text = if target.kind == Kind::Commit {
        commit.subject.clone()
    } else {
        None
    };
    let text = text
        .clone()
        .or(commit_text)
        .unwrap_or_else(|| effective.text.clone());
    Ok((
        Kind::Correct,
        target.task,
        text,
        metadata(commit).or_else(|| effective.commit.clone()),
        Some(id),
    ))
}

fn metadata(args: &CommitArgs) -> Option<Commit> {
    args.hash
        .as_ref()
        .zip(args.subject.as_ref())
        .map(|(hash, subject)| Commit {
            hash: hash.to_ascii_lowercase(),
            subject: subject.clone(),
        })
}
