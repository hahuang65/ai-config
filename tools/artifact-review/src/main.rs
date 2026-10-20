mod artifact;
mod assets;
mod client;
mod event_wait;
mod feedback;
mod feedback_cli;
mod feedback_context;
mod feedback_delivery;
mod feedback_jobs;
mod feedback_registry;
mod feedback_store;
mod feedback_ticket;
mod finding_store;
mod findings;
mod images;
mod model;
mod paths;
mod publication;
mod report_update;
mod server;
mod standalone_store;
mod store;

use clap::{Parser, Subcommand};
use paths::{Paths, Result};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "review-artifact",
    version,
    about = "Review one local HTML file with durable browser feedback."
)]
struct Arguments {
    #[command(subcommand)]
    command: Operation,
}

#[derive(Subcommand)]
enum Operation {
    /// Start or reconnect to a tracked server; start a new review if closed.
    Open {
        file: PathBuf,
        /// Start the server without launching a browser. Never prints the capability.
        #[arg(long)]
        no_browser: bool,
        /// Review each finding from this matching change-review report JSON.
        #[arg(long)]
        findings: Option<PathBuf>,
        /// Use an on-demand read-only responder, never an underlying source repair agent.
        #[arg(long, requires = "findings")]
        standalone: bool,
    },
    #[command(flatten)]
    Feedback(feedback_cli::Command),
    /// Wait in the foreground; replay events after a saved cursor (no destructive reads).
    Poll {
        file: PathBuf,
        #[arg(long, default_value_t = 0)]
        cursor: u64,
        /// Maximum foreground wait in seconds (0 through 60).
        #[arg(long, default_value_t = 20, value_parser = clap::value_parser!(u64).range(0..=60))]
        timeout: u64,
        /// Post a brief agent reply, with a stable ID for safe retries.
        #[arg(long, requires = "id")]
        reply: Option<String>,
        #[arg(long, requires = "reply")]
        id: Option<String>,
    },
    /// Wait indefinitely in the foreground for saved feedback or a closed review.
    Wait {
        file: PathBuf,
        #[arg(long, default_value_t = 0)]
        cursor: u64,
        /// Post a reply with a stable ID; process its returned event before waiting again.
        #[arg(long, requires = "id")]
        reply: Option<String>,
        #[arg(long, requires = "reply")]
        id: Option<String>,
    },
    /// Stop the server without approving, declining, or deleting events.
    Stop { file: PathBuf },
    #[command(name = "_serve", hide = true)]
    Serve { file: PathBuf },
}

fn main() {
    let arguments = Arguments::parse();
    if let Err(message) = validate(&arguments) {
        eprintln!("{message} See review-artifact poll --help or wait --help.");
        std::process::exit(2);
    }
    // All session files, including SQLite journals, are private from creation.
    unsafe {
        libc::umask(0o077);
    }
    match execute(arguments) {
        Ok(Some(output)) => println!("{output}"),
        Ok(None) => (),
        Err(message) => {
            eprintln!("{message}");
            std::process::exit(1);
        }
    }
}

fn validate(arguments: &Arguments) -> Result<()> {
    if let Operation::Poll {
        reply: Some(reply),
        id: Some(id),
        ..
    }
    | Operation::Wait {
        reply: Some(reply),
        id: Some(id),
        ..
    } = &arguments.command
        && (reply.len() > model::MAX_MESSAGE || reply.trim().is_empty() || !model::valid_id(id))
    {
        return Err("Reply needs 1–8000 bytes and an ID of 16–80 letters, digits, or hyphens.");
    }
    Ok(())
}

fn review_paths(command: &Operation) -> Result<(Paths, Option<findings::Binding>)> {
    let file = match command {
        Operation::Open { file, .. }
        | Operation::Poll { file, .. }
        | Operation::Wait { file, .. }
        | Operation::Stop { file }
        | Operation::Serve { file } => file,
        Operation::Feedback(_) => unreachable!("Feedback commands use their own dispatcher"),
    };
    let binding = match command {
        Operation::Open {
            findings: Some(record),
            standalone,
            ..
        } => {
            let mut binding = findings::Binding::read(record)?;
            binding.read_only = *standalone;
            Some(binding)
        }
        _ => None,
    };
    if let Some(binding) = &binding
        && paths::hash(paths::read_artifact(file)?.as_bytes()) != binding.revision
    {
        return Err("Findings report does not match the artifact revision.");
    }
    Ok((Paths::resolve(file)?, binding))
}

fn execute(arguments: Arguments) -> Result<Option<serde_json::Value>> {
    match arguments.command {
        Operation::Feedback(command) => Ok(Some(feedback_cli::execute(command)?)),
        command => execute_review(command),
    }
}

fn execute_review(command: Operation) -> Result<Option<serde_json::Value>> {
    let (paths, binding) = review_paths(&command)?;
    let output = match command {
        Operation::Open { no_browser, .. } => client::open(&paths, no_browser, binding.as_ref())?,
        Operation::Feedback(_) => unreachable!("Feedback commands use their own dispatcher"),
        Operation::Poll {
            cursor,
            timeout,
            reply,
            id,
            ..
        } => client::poll(&paths, cursor, Some(timeout), reply.zip(id))?,
        Operation::Wait {
            cursor, reply, id, ..
        } => client::poll(&paths, cursor, None, reply.zip(id))?,
        Operation::Stop { .. } => client::stop(&paths)?,
        Operation::Serve { .. } => {
            let runtime = tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .enable_all()
                .build()
                .map_err(|_| "Cannot start server runtime.")?;
            runtime.block_on(server::serve(paths))?;
            return Ok(None);
        }
    };
    Ok(Some(output))
}
