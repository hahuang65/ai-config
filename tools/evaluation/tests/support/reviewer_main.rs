//! Test-only process driver for the shared restricted runner, not an installed CLI.
use anyhow::{Context, Result, ensure};
use evaluation::{paths::Paths, reviewer};
use std::{env, ffi::OsString, path::PathBuf};

type Parsed = (Option<PathBuf>, Option<reviewer::Request>);

fn parse() -> Result<Parsed> {
    let mut arguments = env::args_os().skip(1).peekable();
    let root = if arguments.peek().is_some_and(|arg| arg == "--root") {
        arguments.next();
        Some(PathBuf::from(
            arguments
                .next()
                .context("--root needs a source directory")?,
        ))
    } else {
        None
    };
    ensure!(
        arguments.next().as_deref() == Some(std::ffi::OsStr::new("reviewer")),
        "Test driver requires a reviewer request"
    );
    let options: Vec<OsString> = arguments.collect();
    let request = if reviewer::is_help(&options) {
        None
    } else {
        Some(reviewer::parse(&options)?)
    };
    Ok((root, request))
}

fn main() {
    let (root, request) = match parse() {
        Ok(parsed) => parsed,
        Err(error) => {
            eprintln!("reviewer fixture: {error}");
            std::process::exit(2);
        }
    };
    let Some(request) = request else {
        print!("{}", reviewer::HELP);
        return;
    };
    if let Err(error) = Paths::new(root).and_then(|paths| reviewer::launch(&paths, request)) {
        eprintln!("reviewer fixture: {error}");
        std::process::exit(1);
    }
}
