use crate::cli::{FilterState, validate_text};
use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub const SCHEMA: u8 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct Project {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Commit {
    pub hash: String,
    pub subject: String,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Note,
    Start,
    Progress,
    Commit,
    Complete,
    Abandon,
    Correct,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Entry {
    pub schema: u8,
    pub id: u64,
    pub at: String,
    pub project: Option<Project>,
    pub task: Option<u64>,
    pub kind: Kind,
    pub text: String,
    pub commit: Option<Commit>,
    pub corrects: Option<u64>,
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum State {
    Planned,
    Active,
    Completed,
    Abandoned,
}

impl State {
    pub fn matches(self, filter: FilterState) -> bool {
        match filter {
            FilterState::Open => self.is_open(),
            FilterState::Planned => self == Self::Planned,
            FilterState::Active => self == Self::Active,
            FilterState::Completed => self == Self::Completed,
            FilterState::Abandoned => self == Self::Abandoned,
            FilterState::All => true,
        }
    }

    fn is_open(self) -> bool {
        matches!(self, Self::Planned | Self::Active)
    }
}

#[derive(Clone, Serialize)]
pub struct Task {
    pub id: u64,
    pub project: Option<Project>,
    pub title: String,
    pub state: State,
    pub created_at: String,
}

#[derive(Default)]
pub struct Log {
    pub entries: Vec<Entry>,
    pub tasks: BTreeMap<u64, Task>,
    corrections: BTreeMap<u64, u64>,
}

impl Log {
    pub fn from_entries(entries: Vec<Entry>) -> Result<Self> {
        let mut log = Self::default();
        for entry in entries {
            log.apply(entry).map_err(|_| Error::corrupt())?;
        }
        Ok(log)
    }

    pub fn next_id(&self) -> Result<u64> {
        u64::try_from(self.entries.len())
            .ok()
            .and_then(|id| id.checked_add(1))
            .ok_or_else(Error::corrupt)
    }

    pub fn entry(&self, id: u64) -> Result<&Entry> {
        let index = id
            .checked_sub(1)
            .and_then(|index| usize::try_from(index).ok());
        index
            .and_then(|index| self.entries.get(index))
            .ok_or_else(|| Error::usage("unknown entry ID; use history"))
    }

    pub fn effective(&self, entry: &Entry) -> &Entry {
        let id = self.corrections.get(&entry.id).copied().unwrap_or(entry.id);
        &self.entries[(id - 1) as usize]
    }

    pub fn task(&self, id: u64) -> Result<&Task> {
        self.tasks
            .get(&id)
            .ok_or_else(|| Error::usage("unknown task ID; use list --state all"))
    }

    pub fn projects(&self) -> Vec<Project> {
        let mut projects = BTreeMap::new();
        for project in self
            .entries
            .iter()
            .filter_map(|entry| entry.project.as_ref())
        {
            projects.insert(project.id.clone(), project.clone());
        }
        let mut projects: Vec<_> = projects.into_values().collect();
        projects.sort_by(|left, right| (&left.name, &left.id).cmp(&(&right.name, &right.id)));
        projects
    }

    pub fn apply(&mut self, entry: Entry) -> Result<()> {
        self.validate_entry(&entry)?;
        match entry.kind {
            Kind::Note => self.create_task(&entry, State::Planned)?,
            Kind::Start if entry.task == Some(entry.id) => {
                self.create_task(&entry, State::Active)?
            }
            Kind::Start => self.transition(&entry, State::Active)?,
            Kind::Complete => self.transition(&entry, State::Completed)?,
            Kind::Abandon => self.transition(&entry, State::Abandoned)?,
            Kind::Progress | Kind::Commit => self.check_task(&entry)?,
            Kind::Correct => self.correct(&entry)?,
        }
        self.entries.push(entry);
        Ok(())
    }

    fn validate_entry(&self, entry: &Entry) -> Result<()> {
        if entry.schema != SCHEMA || entry.id != self.next_id()? {
            return Err(Error::corrupt());
        }
        OffsetDateTime::parse(&entry.at, &Rfc3339).map_err(|_| Error::corrupt())?;
        validate_text(&entry.text)?;
        if let Some(project) = &entry.project {
            validate_text(&project.name)?;
            if project.id.is_empty() || project.id.chars().any(char::is_control) {
                return Err(Error::corrupt());
            }
        }
        if (entry.kind == Kind::Correct) != entry.corrects.is_some() {
            return Err(Error::corrupt());
        }
        if entry.kind == Kind::Commit && entry.commit.is_none() {
            return Err(Error::corrupt());
        }
        if let Some(commit) = &entry.commit {
            if !matches!(entry.kind, Kind::Commit | Kind::Complete | Kind::Correct)
                || !(7..=64).contains(&commit.hash.len())
                || !commit.hash.bytes().all(|byte| byte.is_ascii_hexdigit())
            {
                return Err(Error::corrupt());
            }
            validate_text(&commit.subject)?;
        }
        Ok(())
    }

    fn create_task(&mut self, entry: &Entry, state: State) -> Result<()> {
        if entry.task != Some(entry.id) {
            return Err(Error::corrupt());
        }
        self.tasks.insert(
            entry.id,
            Task {
                id: entry.id,
                project: entry.project.clone(),
                title: entry.text.clone(),
                state,
                created_at: entry.at.clone(),
            },
        );
        Ok(())
    }

    fn check_task(&self, entry: &Entry) -> Result<()> {
        let Some(id) = entry.task else {
            if entry.project.is_none() {
                return Err(Error::usage(
                    "project-level progress and commits require a project",
                ));
            }
            return Ok(());
        };
        let task = self.task(id)?;
        if !same_project(&task.project, &entry.project) {
            return Err(Error::usage(
                "task belongs to another project; select its project explicitly",
            ));
        }
        if !task.state.is_open() {
            return Err(Error::usage("task is already completed or abandoned"));
        }
        Ok(())
    }

    fn transition(&mut self, entry: &Entry, state: State) -> Result<()> {
        let id = entry.task.ok_or_else(Error::corrupt)?;
        self.check_task(entry)?;
        let task = self.tasks.get_mut(&id).ok_or_else(Error::corrupt)?;
        if state == State::Active && task.state != State::Planned {
            return Err(Error::usage(
                "start requires a planned task; use progress for an active task",
            ));
        }
        task.state = state;
        Ok(())
    }

    fn correct(&mut self, entry: &Entry) -> Result<()> {
        let target = self.entry(entry.corrects.ok_or_else(Error::corrupt)?)?;
        if target.kind == Kind::Correct {
            return Err(Error::usage(
                "correct the original entry, not a correction entry",
            ));
        }
        if !same_project(&target.project, &entry.project) || target.task != entry.task {
            return Err(Error::usage(
                "correction must retain the original project and task",
            ));
        }
        if target.commit.is_some() != entry.commit.is_some() {
            return Err(Error::usage(
                "commit corrections require an original entry with commit metadata",
            ));
        }
        let target_id = target.id;
        let changes_title =
            target.task == Some(target.id) && matches!(target.kind, Kind::Note | Kind::Start);
        if changes_title {
            self.tasks
                .get_mut(&target_id)
                .ok_or_else(Error::corrupt)?
                .title = entry.text.clone();
        }
        self.corrections.insert(target_id, entry.id);
        Ok(())
    }
}

pub fn same_project(left: &Option<Project>, right: &Option<Project>) -> bool {
    left.as_ref().map(|project| &project.id) == right.as_ref().map(|project| &project.id)
}
