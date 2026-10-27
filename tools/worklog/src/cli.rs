use crate::error::{Error, Result};
use clap::{Args, Parser, Subcommand, ValueEnum};
use std::path::PathBuf;
use time::Date;

pub const DEFAULT_LIMIT: usize = 20;
pub const MAX_TEXT_BYTES: usize = 2048;

pub fn program_name() -> &'static str {
    if std::env::args_os().next().is_some_and(|path| {
        std::path::Path::new(&path).file_name() == Some(std::ffi::OsStr::new("worklog"))
    }) {
        "worklog"
    } else {
        "wl"
    }
}

#[derive(Parser)]
#[command(
    version,
    about = "Local reminders and append-only work history",
    after_help = if program_name() == "worklog" {
        "Examples:\n  worklog note 'Check report'\n  worklog start --task 1\n  worklog complete 1 --hash abcdef0 --subject 'Finish report'\n  worklog list --state planned\n  worklog history --all-projects --since 2026-01-01 --json"
    } else {
        "Examples:\n  wl note 'Check report'\n  wl start --task 1\n  wl complete 1 --hash abcdef0 --subject 'Finish report'\n  wl list --state planned\n  wl history --all-projects --since 2026-01-01 --json"
    }
)]
pub struct Cli {
    /// Emit compact JSON on stdout; errors remain on stderr
    #[arg(long, global = true)]
    pub json: bool,
    #[command(flatten)]
    pub scope: Scope,
    #[command(subcommand)]
    pub command: Option<Command>,
}

#[derive(Args, Default)]
pub struct Scope {
    /// Known project name or exact canonical ID from `projects`
    #[arg(long, global = true, conflicts_with_all = ["project_path", "unassigned", "all_projects"])]
    pub project: Option<String>,
    /// Git repository path (default: current directory)
    #[arg(long, global = true, conflicts_with_all = ["unassigned", "all_projects"])]
    pub project_path: Option<PathBuf>,
    /// Explicitly select work without a project
    #[arg(long, global = true, conflicts_with = "all_projects")]
    pub unassigned: bool,
    /// Read across all projects, including unassigned work
    #[arg(long, global = true)]
    pub all_projects: bool,
}

impl Scope {
    pub fn is_explicit(&self) -> bool {
        self.project.is_some()
            || self.project_path.is_some()
            || self.unassigned
            || self.all_projects
    }
}

#[derive(Args)]
pub struct Page {
    /// Maximum rows, oldest first
    #[arg(long, default_value_t = DEFAULT_LIMIT, value_parser = parse_limit)]
    pub limit: usize,
    /// Return every matching row
    #[arg(long, conflicts_with = "limit")]
    pub all: bool,
}

#[derive(Args, Clone)]
pub struct CommitArgs {
    /// Hexadecimal commit ID, 7 to 64 characters
    #[arg(long, requires = "subject")]
    pub hash: Option<String>,
    /// Short commit subject; required with --hash
    #[arg(long, requires = "hash")]
    pub subject: Option<String>,
}

#[derive(Subcommand)]
pub enum Command {
    /// Capture a planned reminder without starting it
    Note { title: String },
    /// Start a new task by title, or an existing planned task by ID
    Start {
        #[arg(required_unless_present = "task", conflicts_with = "task")]
        title: Option<String>,
        #[arg(long, value_parser = parse_id)]
        task: Option<u64>,
    },
    /// Record meaningful progress without changing task state
    Progress {
        summary: String,
        #[arg(long, value_parser = parse_id)]
        task: Option<u64>,
    },
    /// Record a commit without completing a task
    Commit {
        #[arg(long, value_parser = parse_id)]
        task: Option<u64>,
        #[command(flatten)]
        commit: CommitArgs,
    },
    /// Complete a planned or active task; optionally include its finishing commit
    Complete {
        #[arg(value_parser = parse_id)]
        task: u64,
        #[arg(long)]
        summary: Option<String>,
        #[command(flatten)]
        commit: CommitArgs,
    },
    /// Abandon a planned or active task
    Abandon {
        #[arg(value_parser = parse_id)]
        task: u64,
        #[arg(long)]
        summary: String,
    },
    /// Append a factual text or commit correction to an original entry
    Correct {
        #[arg(value_parser = parse_id)]
        entry: u64,
        #[arg(long)]
        text: Option<String>,
        #[command(flatten)]
        commit: CommitArgs,
    },
    /// Show derived tasks; planned reminders are oldest first
    List {
        #[arg(long, value_enum, default_value_t = FilterState::Open)]
        state: FilterState,
        #[command(flatten)]
        page: Page,
    },
    /// Show original entries and their corrected interpretation in append order
    History {
        #[arg(long, value_parser = parse_id)]
        task: Option<u64>,
        /// Inclusive UTC date (YYYY-MM-DD)
        #[arg(long, value_parser = parse_date)]
        since: Option<Date>,
        /// Inclusive UTC date (YYYY-MM-DD)
        #[arg(long, value_parser = parse_date)]
        until: Option<Date>,
        #[command(flatten)]
        page: Page,
    },
    /// Show known project names and IDs from history, without registration
    Projects {
        #[command(flatten)]
        page: Page,
    },
}

#[derive(Clone, Copy, ValueEnum)]
pub enum FilterState {
    Open,
    Planned,
    Active,
    Completed,
    Abandoned,
    All,
}

impl Cli {
    pub fn command(&self) -> &Command {
        self.command.as_ref().unwrap_or(&Command::List {
            state: FilterState::Open,
            page: Page {
                limit: DEFAULT_LIMIT,
                all: true,
            },
        })
    }

    pub fn validate(&self) -> Result<()> {
        if self.scope.all_projects && self.command().is_write() {
            return Err(Error::usage(
                "writes require one project; omit --all-projects",
            ));
        }
        match self.command() {
            Command::Projects { .. } if self.scope.is_explicit() => Err(Error::usage(
                "projects shows all known projects; omit scope options",
            )),
            Command::History {
                since: Some(since),
                until: Some(until),
                ..
            } if since > until => Err(Error::usage("--since must not be later than --until")),
            _ => self.command().validate_text(),
        }
    }
}

impl Command {
    pub fn is_write(&self) -> bool {
        !matches!(
            self,
            Self::List { .. } | Self::History { .. } | Self::Projects { .. }
        )
    }

    fn validate_text(&self) -> Result<()> {
        match self {
            Self::Note { title }
            | Self::Start {
                title: Some(title), ..
            } => validate_text(title),
            Self::Progress { summary, .. } | Self::Abandon { summary, .. } => {
                validate_text(summary)
            }
            Self::Commit { commit, .. } => {
                validate_commit(commit)?;
                if commit.hash.is_none() {
                    return Err(Error::usage("commit requires --hash and --subject"));
                }
                Ok(())
            }
            Self::Complete {
                summary, commit, ..
            } => {
                if let Some(summary) = summary {
                    validate_text(summary)?;
                }
                validate_commit(commit)
            }
            Self::Correct { text, commit, .. } => {
                if text.is_none() && commit.hash.is_none() {
                    return Err(Error::usage(
                        "correct requires --text or --hash with --subject",
                    ));
                }
                if let Some(text) = text {
                    validate_text(text)?;
                }
                validate_commit(commit)
            }
            _ => Ok(()),
        }
    }
}

pub fn validate_text(text: &str) -> Result<()> {
    if text.trim().is_empty() || text.len() > MAX_TEXT_BYTES || text.chars().any(char::is_control) {
        return Err(Error::usage(
            "text must be nonblank, single-line, and at most 2048 bytes",
        ));
    }
    Ok(())
}

fn validate_commit(commit: &CommitArgs) -> Result<()> {
    if let Some(hash) = &commit.hash
        && (!(7..=64).contains(&hash.len()) || !hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
    {
        return Err(Error::usage(
            "--hash must contain 7 to 64 hexadecimal characters",
        ));
    }
    if let Some(subject) = &commit.subject {
        validate_text(subject)?;
    }
    Ok(())
}

fn parse_id(value: &str) -> std::result::Result<u64, &'static str> {
    value
        .parse::<u64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or("use a positive numeric ID")
}

fn parse_limit(value: &str) -> std::result::Result<usize, &'static str> {
    value
        .parse::<usize>()
        .ok()
        .filter(|limit| (1..=10_000).contains(limit))
        .ok_or("use a limit from 1 to 10000, or --all")
}

fn parse_date(value: &str) -> std::result::Result<Date, &'static str> {
    let format = time::format_description::parse_borrowed::<2>("[year]-[month]-[day]").unwrap();
    Date::parse(value, &format).map_err(|_| "use a valid UTC date in YYYY-MM-DD format")
}
