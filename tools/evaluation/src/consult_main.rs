//! Source-local specialist consultation; no public shell alias is installed.
use anyhow::{Context, Result};
use evaluation::{consult, paths::Paths};
use std::{env, ffi::OsString, path::PathBuf};

fn parse() -> Result<(Option<PathBuf>, Vec<OsString>)> {
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
    let arguments: Vec<_> = arguments.collect();
    if !consult::is_help(&arguments) {
        consult::parse(&arguments)?;
    }
    Ok((root, arguments))
}

fn main() {
    let (root, arguments) = match parse() {
        Ok(request) => request,
        Err(error) => {
            eprintln!("consult: {error}");
            std::process::exit(2);
        }
    };
    if consult::is_help(&arguments) {
        print!("{}", consult::HELP);
        return;
    }
    let result =
        Paths::new(root).and_then(|paths| consult::launch(&paths, consult::parse(&arguments)?));
    if let Err(error) = result {
        eprintln!("consult: {error}");
        std::process::exit(1);
    }
}
