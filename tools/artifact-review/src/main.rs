mod client;
mod images;
mod model;
mod paths;
mod server;
mod store;

use clap::{Parser, Subcommand};
use paths::{Paths, Result};
use std::path::PathBuf;

#[derive(Parser)]
#[command(
    name = "artifact-review",
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
    },
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
    /// Stop the server without approving, declining, or deleting events.
    Stop { file: PathBuf },
    #[command(name = "_serve", hide = true)]
    Serve { file: PathBuf },
}

fn main() {
    let arguments = Arguments::parse();
    if let Err(message) = validate(&arguments) {
        eprintln!("{message} See artifact-review poll --help.");
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
    } = &arguments.command
        && (reply.len() > model::MAX_MESSAGE || reply.trim().is_empty() || !model::valid_id(id))
    {
        return Err("Reply needs 1–8000 bytes and an ID of 16–80 letters, digits, or hyphens.");
    }
    Ok(())
}

fn execute(arguments: Arguments) -> Result<Option<serde_json::Value>> {
    let file = match &arguments.command {
        Operation::Open { file, .. }
        | Operation::Poll { file, .. }
        | Operation::Stop { file }
        | Operation::Serve { file } => file,
    };
    let paths = Paths::resolve(file)?;
    let output = match arguments.command {
        Operation::Open { no_browser, .. } => client::open(&paths, no_browser)?,
        Operation::Poll {
            cursor,
            timeout,
            reply,
            id,
            ..
        } => client::poll(&paths, cursor, timeout, reply.zip(id))?,
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
