use crate::change_types::text;
use anyhow::{Context, Result, bail, ensure};
use std::{collections::BTreeSet, path::PathBuf};

pub const HELP: &str = "Usage: review-change-eval [--root EVALUATION] review local|range BASE..HEAD|pr URL --intent TEXT [options]
       review-change-eval [--root EVALUATION] post REPORT [--state-dir DIR]
Options: --repo DIR, --path LITERAL_RELATIVE_PATH, --state-dir DIR, --engine pi|claude (default pi),
         --provider NAME, --model ID, --thinking LEVEL,
         --timeout SECONDS (1..3600), --json, --no-browser.
Local includes tracked and non-ignored untracked files against HEAD; range compares two exact commits.
Excluded private, binary, symlink and submodule files are reported; oversized snapshots fail, never truncate silently.
Reports contain untrusted reviewer claims, not test execution evidence. Source code is never executed.
JSON mode never prompts or opens a browser. Reviews never post automatically.
Post requires a retained report and a human terminal; no automatic approval flag exists.
Exit codes: 0 completed, 1 operational failure, 2 invalid invocation.
";

pub enum Target {
    Local,
    Range(String, String),
    Pull(String),
    Post(PathBuf),
    Help,
}
pub struct Args {
    pub root: Option<PathBuf>,
    pub target: Target,
    pub repo: PathBuf,
    pub path_filter: Option<String>,
    pub state: Option<PathBuf>,
    pub intent: String,
    pub json: bool,
    pub no_browser: bool,
    pub model: Vec<String>,
}

fn range(value: &str) -> Result<Target> {
    ensure!(
        !value.contains("..."),
        "Use an explicit two-dot BASE..HEAD range"
    );
    let (base, head) = value.split_once("..").context("Use BASE..HEAD")?;
    for revision in [base, head] {
        text(revision, 1024)?;
        ensure!(
            !revision.starts_with('-') && !revision.contains(['\n', '\t']),
            "Invalid revision"
        );
    }
    Ok(Target::Range(base.into(), head.into()))
}

pub fn parse(values: Vec<String>) -> Result<Args> {
    let mut values = values.into_iter().peekable();
    let root = if values.peek().is_some_and(|v| v == "--root") {
        values.next();
        Some(PathBuf::from(values.next().context("--root needs a path")?))
    } else {
        None
    };
    let target = target(&mut values)?;
    let mut args = Args {
        root,
        target,
        repo: ".".into(),
        path_filter: None,
        state: None,
        intent: String::new(),
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

fn target(values: &mut impl Iterator<Item = String>) -> Result<Target> {
    Ok(match values.next().as_deref() {
        None | Some("--help" | "-h") => Target::Help,
        Some("post") => Target::Post(values.next().context("post needs a report path")?.into()),
        Some("review") => match values.next().as_deref() {
            Some("local") => Target::Local,
            Some("range") => range(&values.next().context("range needs BASE..HEAD")?)?,
            Some("pr") => Target::Pull(values.next().context("pr needs a GitHub URL")?),
            _ => bail!("Choose review local, range BASE..HEAD, or pr URL"),
        },
        _ => bail!("Unknown command; use --help"),
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
        "--intent" => args.intent = value,
        "--engine" | "--provider" | "--model" | "--thinking" | "--timeout" => {
            args.model.extend([name.into(), value])
        }
        _ => bail!("Unsupported option: {name}; use --help"),
    }
    Ok(())
}

fn validate(args: &Args) -> Result<()> {
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
