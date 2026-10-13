//! Restricted reviewer entry point. Installation is handled by the separate ai-config binary.
use anyhow::{Context, Result, bail};
use evaluation::{configuration_install, consult, paths::Paths, reviewer};
use std::env;
use std::ffi::OsString;
use std::path::PathBuf;

const HELP: &str = "Usage: evaluation [--root ABSOLUTE_SOURCE] reviewer|consult|native-install [arguments...]\nRestricted snapshot reviewer and consultation runner. Use ai-config for ordinary installation.\n";

struct Request {
    root: Option<PathBuf>,
    action: String,
    arguments: Vec<OsString>,
}

fn parse() -> Result<Request> {
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
    let action = arguments
        .next()
        .context(HELP)?
        .into_string()
        .map_err(|_| anyhow::anyhow!(HELP))?;
    let arguments: Vec<_> = arguments.collect();
    match action.as_str() {
        "reviewer" if reviewer::is_help(&arguments) => {}
        "reviewer" => {
            reviewer::parse(&arguments)?;
        }
        "consult" if consult::is_help(&arguments) => {}
        "consult" => {
            consult::parse(&arguments)?;
        }
        "native-install" if configuration_install::is_help(&arguments) => {}
        "native-install" => {
            configuration_install::parse(&arguments)?;
        }
        "--help" | "-h" if arguments.is_empty() => {}
        _ => bail!(HELP),
    }
    Ok(Request {
        root,
        action,
        arguments,
    })
}

fn run(request: Request) -> Result<()> {
    if matches!(request.action.as_str(), "--help" | "-h") {
        print!("{HELP}");
        return Ok(());
    }
    if request.action == "native-install" && configuration_install::is_help(&request.arguments) {
        print!("{}", configuration_install::HELP);
        return Ok(());
    }
    let paths = Paths::new(request.root)?;
    match request.action.as_str() {
        "reviewer" if reviewer::is_help(&request.arguments) => print!("{}", reviewer::HELP),
        "reviewer" => reviewer::launch(&paths, reviewer::parse(&request.arguments)?)?,
        "consult" if consult::is_help(&request.arguments) => print!("{}", consult::HELP),
        "consult" => consult::launch(&paths, consult::parse(&request.arguments)?)?,
        "native-install" => {
            let options = configuration_install::parse(&request.arguments)?;
            configuration_install::launch(&paths, &options)?;
        }
        _ => unreachable!(),
    }
    Ok(())
}

fn main() {
    let request = match parse() {
        Ok(request) => request,
        Err(error) => {
            eprintln!("evaluation: {error}");
            std::process::exit(2);
        }
    };
    if let Err(error) = run(request) {
        eprintln!("evaluation: {error}");
        std::process::exit(1);
    }
}
