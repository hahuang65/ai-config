use crate::change_types::text;
use anyhow::{Context, Result, bail, ensure};
use std::{collections::BTreeSet, path::PathBuf};

pub const HELP: &str = "Usage: review-change [SUBJECT] [options]

  review-change https://github.com/OWNER/REPO/pull/123
  review-change feature-branch
  review-change worktree-name
  review-change https://github.com/OWNER/REPO/tree/BRANCH
  review-change 'X..Y'
  review-change

SUBJECT is a PR URL, branch/worktree name or path, GitHub branch/repository URL,
or a two-dot Git revision range. With no subject, review the current branch and
outstanding changes from its merge base with trunk. Branch/worktree subjects
include working changes only when that branch has a selected registered worktree.
Trunk uses the remote default (origin preferred), then unambiguous main/master.
The HTML opens in review-artifact. Select and confirm publication there;
reviews and repair Accept/Reject decisions never publish automatically.
No manual intent field is needed; available PR and commit context is unverified intent.

Options: --repo DIR (default current directory), --path LITERAL_RELATIVE_PATH,
         --engine pi|claude (default pi), --provider NAME, --model ID, --thinking LEVEL,
         --timeout SECONDS (1..3600), --json, --no-browser, --state-dir ABSOLUTE_DIR.
Human runs log timestamped step starts/ends, elapsed times and verified reads on stderr.
Terminals also show an overall workflow-stage bar and total time, not analysis percentages.
Redirected logs stay plain; quiet reviewer periods include elapsed-time updates.
JSON mode suppresses progress and never opens a browser or posts.
An optional --intent TEXT supplies explicit acceptance context for automation.
Private, binary, symlink and submodule evidence is excluded and reported.
External command outputs and runtimes are bounded; source code is never executed.
Exit codes: 0 completed, 1 operational failure, 2 invalid invocation.
";

#[derive(Clone)]
pub enum Target {
    Local,
    Current,
    Working {
        head: String,
        branch: Option<String>,
    },
    Branch(String),
    Range(String, String),
    Expression(String),
    Pull(String),
    Github(String),
    Post(PathBuf),
    Help,
}
#[derive(Clone)]
pub struct Args {
    pub root: Option<PathBuf>,
    pub target: Target,
    pub repo: PathBuf,
    pub path_filter: Option<String>,
    pub state: Option<PathBuf>,
    pub intent: String,
    pub infer_intent: bool,
    pub json: bool,
    pub no_browser: bool,
    pub model: Vec<String>,
}

fn range(value: &str) -> Result<Target> {
    ensure!(
        !value.contains("..."),
        "Use an explicit two-dot BASE..HEAD range"
    );
    text(value, 2048)?;
    ensure!(
        value.contains("..") && !value.starts_with('-') && !value.contains(['\n', '\t']),
        "Use an explicit two-dot X..Y range"
    );
    Ok(Target::Expression(value.into()))
}

pub fn parse(values: Vec<String>) -> Result<Args> {
    let mut values = values.into_iter().peekable();
    let root = if values.peek().is_some_and(|v| v == "--root") {
        values.next();
        Some(PathBuf::from(values.next().context("--root needs a path")?))
    } else {
        None
    };
    let human = !values
        .peek()
        .is_some_and(|value| value == "review" || value == "post");
    let target = target(&mut values)?;
    let mut args = Args {
        root,
        target,
        repo: ".".into(),
        path_filter: None,
        state: None,
        intent: if human {
            crate::change_intent::DEFAULT.into()
        } else {
            String::new()
        },
        infer_intent: human,
        json: false,
        no_browser: false,
        model: vec![],
    };
    let mut seen = BTreeSet::new();
    while let Some(name) = values.next() {
        ensure!(seen.insert(name.clone()), "Duplicate option: {name}");
        ensure!(
            !matches!(args.target, Target::Help),
            "Help does not accept further arguments"
        );
        if matches!(args.target, Target::Post(_)) {
            ensure!(
                name == "--state-dir",
                "post accepts only --state-dir; confirmation is interactive"
            );
        }
        match name.as_str() {
            "--json" => args.json = true,
            "--no-browser" => args.no_browser = true,
            _ => option(
                &mut args,
                &name,
                values.next().context("Option needs a value")?,
            )?,
        }
    }
    validate(&args)?;
    Ok(args)
}

fn target(values: &mut std::iter::Peekable<impl Iterator<Item = String>>) -> Result<Target> {
    if values
        .peek()
        .is_some_and(|value| value.starts_with('-') && value != "--help" && value != "-h")
    {
        return Ok(Target::Current);
    }
    Ok(match values.next().as_deref() {
        None => Target::Current,
        Some("--help" | "-h") => Target::Help,
        Some("post") => Target::Post(values.next().context("post needs a report path")?.into()),
        Some("review") => match values.next().as_deref() {
            Some("local") => Target::Local,
            Some("range") => range(&values.next().context("range needs BASE..HEAD")?)?,
            Some("pr") => Target::Pull(values.next().context("pr needs a GitHub URL")?),
            _ => bail!("Choose review local, range BASE..HEAD, or pr URL"),
        },
        Some(subject) if subject.starts_with("https://") => Target::Github(subject.into()),
        Some(subject) if subject.contains("..") => range(subject)?,
        Some(subject) => {
            text(subject, 4096)?;
            Target::Branch(subject.into())
        }
    })
}

fn option(args: &mut Args, name: &str, value: String) -> Result<()> {
    text(&value, 8192)?;
    match name {
        "--repo" => args.repo = value.into(),
        "--path" => {
            crate::change_types::relative_path(&value)?;
            args.path_filter = Some(value);
        }
        "--state-dir" => args.state = Some(value.into()),
        "--intent" => {
            args.intent = value;
            args.infer_intent = false;
        }
        "--engine" | "--provider" | "--model" | "--thinking" | "--timeout" => {
            args.model.extend([name.into(), value])
        }
        _ => bail!("Unsupported option: {name}; use --help"),
    }
    Ok(())
}

fn validate(args: &Args) -> Result<()> {
    if let Target::Github(url) = &args.target {
        text(url, 4096)?;
        crate::change_url::parse(url)?;
    }
    if let Target::Pull(url) = &args.target {
        text(url, 4096)?;
        crate::change_provider::identity(url)?;
    }
    if !matches!(args.target, Target::Help | Target::Post(_)) {
        text(&args.intent, 8192).context("Review requires --intent TEXT")?;
    }
    if let Some(path) = &args.state {
        ensure!(path.is_absolute(), "--state-dir must be absolute");
    }
    let mut model = vec![
        "--snapshot".into(),
        "/placeholder".into(),
        "--prompt".into(),
        "validate".into(),
    ];
    model.extend(args.model.iter().map(Into::into));
    crate::reviewer::parse(&model)?;
    Ok(())
}
