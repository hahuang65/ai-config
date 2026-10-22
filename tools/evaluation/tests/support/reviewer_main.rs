//! Test-only process driver for the shared restricted runner, not an installed CLI.
use anyhow::{Context, Result, ensure};
use evaluation::{paths::Paths, reviewer};
use std::{env, ffi::OsString, path::PathBuf};

mod timeout_provider;

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

fn feedback() -> Result<()> {
    let args: Vec<_> = env::args().skip(2).collect();
    ensure!(
        args.len() == 4,
        "Feedback fixture needs HTML, digest, revision, and JSON event"
    );
    let event: serde_json::Value = serde_json::from_str(&args[3])?;
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    if let Some(started) = event["fixture_started"].as_str() {
        let started = PathBuf::from(started);
        let flag = cancel.clone();
        std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            while !started.is_file() && std::time::Instant::now() < deadline {
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        });
    }
    let response = evaluation::feedback_response::respond(
        PathBuf::from(&args[0]).as_path(),
        &args[1],
        &args[2],
        &event,
        cancel,
    )?;
    if let Some(edit) = &response.revision {
        evaluation::report_edit::apply(
            PathBuf::from(&args[0]).as_path(),
            &args[1],
            &args[2],
            edit,
        )?;
    }
    println!("{}", serde_json::to_string(&response)?);
    Ok(())
}

fn main() {
    if let Some(code) = timeout_provider::selected_exit() {
        std::process::exit(code);
    }
    if env::args().nth(1).as_deref() == Some("feedback") {
        if let Err(error) = feedback() {
            eprintln!("Feedback fixture: {error}");
            std::process::exit(1);
        }
        return;
    }
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
